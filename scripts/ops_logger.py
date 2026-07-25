#!/usr/bin/env python3
"""
OPS Logger - ETL 监控记录模块
用途：记录 ETL 每步运行状态到 ops.pipeline_run / ops.pipeline_step_run

功能：
  - 创建/更新 pipeline_run（一次完整运行）
  - 创建/更新 pipeline_step_run（每个步骤的执行明细）
  - 失败时不影响主流程（记录失败会 catch 并打印 WARN）

使用示例：
  from ops_logger import OpsLogger

  # 初始化（会自动创建 pipeline_run）
  ops = OpsLogger(brand_code="yufeng", store_code="yf_gh", month="2026-03", triggered_by="manual")

  # 步骤开始
  ops.step_start("register_file", step_order=1, detail={"file_path": "xxx.xlsx"})

  # 步骤成功
  ops.step_end("register_file", rows_out=100, detail={"file_id": 123})

  # 步骤失败
  ops.step_end("register_file", status="failed", error_message="File not found")

  # Pipeline 结束
  ops.finish(status="success")
"""

import os
import sys
import uuid
import warnings
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator, Optional

import psycopg2
from psycopg2 import extras


# =====================
# 配置
# =====================
DEFAULT_DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "dataplatform"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "trust-auth-no-password-needed"),
}


class OpsLogger:
    """
    ETL 监控记录器

    用法：
        ops = OpsLogger(brand_code="yufeng", store_code="yf_gh", month="2026-03")
        ops.step_start("register_file")
        ops.step_end("register_file", rows_out=100)
        ops.finish(status="success")
    """

    def __init__(
        self,
        brand_code: str,
        store_code: Optional[str] = None,
        month: Optional[str] = None,
        triggered_by: str = "manual",
        note: Optional[str] = None,
        db_config: Optional[dict] = None,
    ):
        """
        初始化并创建 pipeline_run 记录

        Args:
            brand_code: 品牌编码 (bonjur / yufeng)
            store_code: 门店编码（可选）
            month: 月份 (YYYY-MM)
            triggered_by: 触发方式 (cron / manual)
            note: 备注
            db_config: 数据库配置（可选，默认读取环境变量）
        """
        self.brand_code = brand_code
        self.store_code = store_code
        self.month = month
        self.triggered_by = triggered_by
        self.note = note
        self.db_config = db_config or DEFAULT_DB_CONFIG
        self.run_id: Optional[uuid.UUID] = None
        self._conn = None

        # 存储每个步骤的开始时间（用于计算耗时）
        self._step_start_times: dict[str, datetime] = {}

        # 创建 pipeline_run
        self._create_pipeline_run()

    def _get_connection(self):
        """获取数据库连接"""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(**self.db_config)
        return self._conn

    def _create_pipeline_run(self):
        """创建 pipeline_run 记录"""
        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                self.run_id = uuid.uuid4()
                # PostgreSQL uuid 类型需要字符串传入，让 DB 自动 cast
                cur.execute(
                    """
                    INSERT INTO ops.pipeline_run
                        (run_id, brand_code, store_code, month, triggered_by, note, status, started_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 'running', NOW())
                    """,
                    (str(self.run_id), self.brand_code, self.store_code, self.month, self.triggered_by, self.note),
                )
                conn.commit()
        except Exception as e:
            warnings.warn(f"[OPS] Failed to create pipeline_run: {e}")
            self.run_id = None

    def _create_step_run(self, step_name: str, step_order: int, detail: Optional[dict] = None) -> Optional[int]:
        """
        创建 pipeline_step_run 记录（开始步骤）

        Returns:
            step_id 或 None（如果创建失败）
        """
        if not self.run_id:
            return None

        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ops.pipeline_step_run
                        (run_id, step_name, step_order, status, started_at, detail)
                    VALUES (%s, %s, %s, 'running', NOW(), %s)
                    RETURNING step_id
                    """,
                    (str(self.run_id), step_name, step_order, psycopg2.extras.Json(detail) if detail else None),
                )
                step_id = cur.fetchone()[0]
                conn.commit()
                return step_id
        except Exception as e:
            warnings.warn(f"[OPS] Failed to create step_run for {step_name}: {e}")
            return None

    def _update_step_run(
        self,
        step_name: str,
        status: str,
        rows_out: Optional[int] = None,
        rows_rejected: Optional[int] = None,
        error_message: Optional[str] = None,
        detail: Optional[dict] = None,
    ):
        """
        更新 pipeline_step_run 记录（结束步骤）

        Args:
            step_name: 步骤名称
            status: 状态 (success / failed / skipped)
            rows_out: 输出行数
            rows_rejected: 拒绝行数
            error_message: 错误信息
            detail: 额外信息
        """
        if not self.run_id:
            return

        # 计算耗时
        duration_sec = None
        if step_name in self._step_start_times:
            start_time = self._step_start_times[step_name]
            duration_sec = int((datetime.now() - start_time).total_seconds())

        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                # 构建更新语句
                updates = ["status = %s", "finished_at = NOW()"]
                params = [status]

                if rows_out is not None:
                    updates.append("rows_out = %s")
                    params.append(rows_out)

                if rows_rejected is not None:
                    updates.append("rows_rejected = %s")
                    params.append(rows_rejected)

                if duration_sec is not None:
                    updates.append("duration_sec = %s")
                    params.append(duration_sec)

                if error_message:
                    updates.append("error_message = %s")
                    params.append(error_message)

                if detail:
                    updates.append("detail = %s")
                    params.append(psycopg2.extras.Json(detail))

                params.append(str(self.run_id))
                params.append(step_name)

                cur.execute(
                    f"""
                    UPDATE ops.pipeline_step_run
                    SET {', '.join(updates)}
                    WHERE run_id = %s AND step_name = %s
                    """,
                    params,
                )
                conn.commit()
        except Exception as e:
            warnings.warn(f"[OPS] Failed to update step_run for {step_name}: {e}")

    def step_start(self, step_name: str, step_order: int = 0, detail: Optional[dict] = None):
        """
        标记步骤开始

        Args:
            step_name: 步骤名称
            step_order: 执行顺序
            detail: 额外信息（如文件路径）
        """
        self._step_start_times[step_name] = datetime.now()
        self._create_step_run(step_name, step_order, detail)

    def step_end(
        self,
        step_name: str,
        status: str = "success",
        rows_out: Optional[int] = None,
        rows_rejected: Optional[int] = None,
        error_message: Optional[str] = None,
        detail: Optional[dict] = None,
        rollback: bool = False,
    ):
        """
        标记步骤结束

        Args:
            step_name: 步骤名称
            status: 状态 (success / failed / skipped)
            rows_out: 输出行数
            rows_rejected: 拒绝行数
            error_message: 错误信息
            detail: 额外信息
            rollback: 是否标记为回滚（清除 rows_out，记录回滚原因）
        """
        if rollback:
            status = "rollback"
            detail = {**(detail or {}), "rollback": True, "rollback_reason": error_message or "cancelled by pipeline"}

        self._update_step_run(
            step_name=step_name,
            status=status,
            rows_out=None if rollback else rows_out,
            rows_rejected=rows_rejected,
            error_message=error_message,
            detail=detail,
        )

        # 清除开始时间记录
        if step_name in self._step_start_times:
            del self._step_start_times[step_name]

    def finish(self, status: str = "success", note: Optional[str] = None):
        """
        标记 Pipeline 结束

        Args:
            status: 运行状态 (success / failed)
            note: 备注
        """
        if not self.run_id:
            return

        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ops.pipeline_run
                    SET status = %s, finished_at = NOW(), note = COALESCE(%s, note)
                    WHERE run_id = %s
                    """,
                    (status, note, str(self.run_id)),
                )
                conn.commit()
        except Exception as e:
            warnings.warn(f"[OPS] Failed to finish pipeline_run: {e}")
        finally:
            self.close()

    def close(self):
        """关闭数据库连接"""
        if self._conn and not self.closed:
            try:
                self._conn.close()
            except Exception:
                pass

    @property
    def closed(self):
        return self._conn is None or self._conn.closed

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            # 有异常，标记为失败
            self.finish(status="failed", note=str(exc_val)[:500])
        self.close()
        return False


def create_ops_logger(
    brand_code: str,
    store_code: Optional[str] = None,
    month: Optional[str] = None,
    triggered_by: str = "manual",
    note: Optional[str] = None,
    db_config: Optional[dict] = None,
) -> Optional[OpsLogger]:
    """
    工厂函数：创建 OpsLogger 实例

    如果 ops 表不存在或连接失败，返回 None（不阻塞主流程）

    Args:
        brand_code: 品牌编码
        store_code: 门店编码
        month: 月份
        triggered_by: 触发方式
        note: 备注
        db_config: 数据库配置

    Returns:
        OpsLogger 实例或 None
    """
    # month 字段在 DB 里是 date；允许传 YYYY-MM，但需要转成 YYYY-MM-01
    if month and isinstance(month, str):
        m = month.strip()
        if len(m) == 7 and m[4] == "-":
            # "2026-03" -> "2026-03-01"
            month = f"{m}-01"

    try:
        return OpsLogger(
            brand_code=brand_code,
            store_code=store_code,
            month=month,
            triggered_by=triggered_by,
            note=note,
            db_config=db_config,
        )
    except Exception as e:
        warnings.warn(f"[OPS] Failed to create OpsLogger: {e}")
        return None


@contextmanager
def pipeline_step(ops: Optional[OpsLogger], step_name: str, step_order: int, *, detail: Optional[dict] = None) -> Iterator[None]:
    """
    Context manager wrapping a pipeline step for automatic lifecycle management.

    Auto-starts the step on enter, auto-ends with 'success' on clean exit,
    and auto-ends with 'failed' + error_message on exception.

    Usage:
        with pipeline_step(ops, "apply_classification_sql", step_order=3):
            run_classification()
        # step_end("success") called automatically

        with pipeline_step(ops, "apply_classification_sql", step_order=3):
            raise RuntimeError("crash")
        # step_end("failed", error_message="crash") called automatically, exception re-raised
    """
    if ops:
        ops.step_start(step_name, step_order, detail=detail)
    try:
        yield
    except Exception:
        if ops:
            ops.step_end(step_name, status="failed", error_message=str(sys.exc_info()[1])[:500])
        raise
    else:
        if ops:
            ops.step_end(step_name, rows_out=1)
