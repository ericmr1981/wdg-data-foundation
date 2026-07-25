"""
discount_model pipeline 共享工具：
  - 数据库连接（psycopg2）
  - run_id / version 生成
  - ops.pipeline_run / pipeline_step_run 写入
  - 取消标志轮询（ops.pipeline_run.cancel_requested）
  - ops.discount_model_snapshot 读写
  - is_active 切换 + fallback_to 维护
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[FATAL] psycopg2 not installed. Run: pip install psycopg2-binary", file=sys.stderr)
    raise


# =====================
# DB config（与项目其余脚本一致）
# =====================
def db_config() -> dict:
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
        "database": os.getenv("DB_NAME", "dataplatform"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.environ["DB_PASSWORD"],
    }


def connect():
    return psycopg2.connect(**db_config())


# =====================
# 版本号 / run_id
# =====================
def new_version() -> str:
    """生成 YYYY-MM-DDTHH-MM-SS 版本号。"""
    return datetime.now().strftime("%Y-%m-%dT%H-%M-%S")


def new_run_id() -> str:
    return uuid.uuid4().hex


# =====================
# ops.pipeline_run 操作
# =====================
def create_pipeline_run(
    *,
    run_id: str,
    version: str,
    pipeline: str,
    store_code: str = "sh_xtd",
    data_range_start: str | None = None,
    data_range_end: str | None = None,
    note: str | None = None,
) -> None:
    """upsert：行不存在则创建，存在则补齐 pipeline 元数据。"""
    sql = """
        INSERT INTO ops.pipeline_run
            (run_id, brand_code, module, pipeline, version, store_code,
             data_range_start, data_range_end, status, triggered_by, note)
        VALUES (%s, 'discount_model', 'discount_model', %s, %s, %s,
                %s, %s, 'running', 'manual', %s)
        ON CONFLICT (run_id) DO UPDATE SET
            pipeline         = EXCLUDED.pipeline,
            version          = EXCLUDED.version,
            store_code       = EXCLUDED.store_code,
            data_range_start = COALESCE(ops.pipeline_run.data_range_start, EXCLUDED.data_range_start),
            data_range_end   = COALESCE(ops.pipeline_run.data_range_end, EXCLUDED.data_range_end),
            note             = COALESCE(ops.pipeline_run.note, EXCLUDED.note)
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, (
            run_id, pipeline, version, store_code,
            data_range_start, data_range_end, note,
        ))


def finish_pipeline_run(run_id: str, status: str, *, is_active: bool | None = None,
                         warnings: list[str] | None = None) -> None:
    """结束 run：成功→is_active=true；失败→is_active=false。
    同步把上一 active 行降级，并写入 fallback_to。
    """
    warnings = warnings or []
    sql_update = """
        UPDATE ops.pipeline_run
        SET status=%s,
            finished_at=NOW(),
            is_active=COALESCE(%s, is_active),
            warnings=%s::jsonb
        WHERE run_id=%s
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql_update, (status, is_active, json.dumps(warnings), run_id))

        if is_active is True:
            # 降级其他 active
            cur.execute("""
                UPDATE ops.pipeline_run
                SET is_active=false,
                    fallback_to=(SELECT version FROM ops.pipeline_run WHERE run_id=%s)
                WHERE module='discount_model' AND is_active=true AND run_id<>%s
            """, (run_id, run_id))
        elif is_active is False:
            # 回退到上一 active 版本
            cur.execute("""
                UPDATE ops.pipeline_run
                SET fallback_to=(
                    SELECT version FROM ops.pipeline_run
                    WHERE module='discount_model' AND is_active=true
                      AND run_id<>%s
                    ORDER BY finished_at DESC NULLS LAST LIMIT 1
                )
                WHERE run_id=%s
            """, (run_id, run_id))
        conn.commit()


def set_cancel_requested(run_id: str) -> bool:
    """设置取消标志（仅 MCP cancel 工具调用）。返回是否成功。"""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE ops.pipeline_run
            SET cancel_requested=true
            WHERE run_id=%s AND status='running'
            RETURNING run_id
        """, (run_id,))
        return cur.fetchone() is not None


def is_cancel_requested(run_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT cancel_requested FROM ops.pipeline_run WHERE run_id=%s
        """, (run_id,))
        row = cur.fetchone()
        return bool(row and row[0])


# =====================
# ops.pipeline_step_run 操作
# =====================
def start_step(run_id: str, step_name: str, step_order: int,
               *, detail: dict | None = None) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO ops.pipeline_step_run
                (run_id, step_name, step_order, status, started_at, detail)
            VALUES (%s, %s, %s, 'running', NOW(), %s)
            RETURNING step_id
        """, (run_id, step_name, step_order,
              psycopg2.extras.Json(detail) if detail else None))
        step_id = cur.fetchone()[0]
        conn.commit()
        return step_id


def finish_step(step_id: int, *, status: str,
                rows_out: int | None = None,
                error_message: str | None = None,
                detail: dict | None = None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE ops.pipeline_step_run
            SET status=%s,
                finished_at=NOW(),
                duration_sec=EXTRACT(EPOCH FROM (NOW() - started_at))::int,
                rows_out=COALESCE(%s, rows_out),
                error_message=%s,
                detail=COALESCE(%s, detail)
            WHERE step_id=%s
        """, (status, rows_out, error_message,
              psycopg2.extras.Json(detail) if detail else None, step_id))
        conn.commit()


# =====================
# 步骤装饰器
# =====================
CANCEL_POLL_INTERVAL = 5  # 秒


@contextmanager
def step_context(run_id: str, step_name: str, step_order: int,
                 *, detail: dict | None = None, cancellable: bool = True):
    """自动开始/结束 step；cancellable=True 时在入口检查取消标志。"""
    if cancellable and is_cancel_requested(run_id):
        step_id = start_step(run_id, step_name, step_order, detail={**(detail or {}), "skipped": "cancel_requested"})
        finish_step(step_id, status="cancelled")
        yield {"cancelled": True}
        return
    step_id = start_step(run_id, step_name, step_order, detail=detail)
    try:
        result: dict[str, Any] = {}
        yield result
        finish_step(step_id, status="success",
                    rows_out=result.get("rows_out"),
                    detail=result.get("detail") or detail)
    except Exception as e:
        msg = format_error(e, code=step_name.upper())
        finish_step(step_id, status="failed", error_message=msg)
        raise


def format_error(exc: BaseException, *, code: str = "ERROR") -> str:
    return f"[{code}] {type(exc).__name__}: {exc}\nhint: 查看完整 traceback 在脚本 stderr 输出"


# =====================
# ops.discount_model_snapshot 操作
# =====================
def upsert_snapshot(*, version: str, kind: str, store_code: str,
                    payload: dict, run_id: str | None = None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO ops.discount_model_snapshot
                (version, kind, store_code, payload, run_id)
            VALUES (%s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (version, kind, store_code)
            DO UPDATE SET payload=EXCLUDED.payload,
                          generated_at=NOW(),
                          run_id=EXCLUDED.run_id
        """, (version, kind, store_code, json.dumps(payload), run_id))
        conn.commit()


def get_snapshot(*, version: str | None, kind: str,
                 store_code: str = "sh_xtd") -> dict | None:
    """version=None 时取最新 is_active=true 版本的对应 kind。"""
    with connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if version is None:
            cur.execute("""
                SELECT s.payload, s.version, s.generated_at, s.run_id,
                       r.data_range_start, r.data_range_end, r.warnings
                FROM ops.discount_model_snapshot s
                JOIN ops.pipeline_run r
                  ON r.module='discount_model' AND r.version=s.version
                WHERE s.kind=%s AND s.store_code=%s AND r.is_active=true
                ORDER BY s.generated_at DESC LIMIT 1
            """, (kind, store_code))
        else:
            cur.execute("""
                SELECT s.payload, s.version, s.generated_at, s.run_id,
                       r.data_range_start, r.data_range_end, r.warnings
                FROM ops.discount_model_snapshot s
                LEFT JOIN ops.pipeline_run r
                  ON r.module='discount_model' AND r.version=s.version
                WHERE s.kind=%s AND s.store_code=%s AND s.version=%s
                LIMIT 1
            """, (kind, store_code, version))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "version": row["version"],
            "kind": kind,
            "store_code": store_code,
            "generated_at": row["generated_at"].isoformat() if row["generated_at"] else None,
            "run_id": row["run_id"],
            "data_range_start": row["data_range_start"].isoformat() if row["data_range_start"] else None,
            "data_range_end": row["data_range_end"].isoformat() if row["data_range_end"] else None,
            "warnings": row["warnings"] or [],
            "payload": row["payload"],
        }


# =====================
# 后台轮询工具（用于 train 阶段）
# =====================
class CancelToken:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self._last = 0.0

    def check(self) -> bool:
        now = time.time()
        if now - self._last < CANCEL_POLL_INTERVAL:
            return False
        self._last = now
        return is_cancel_requested(self.run_id)


# =====================
# artifacts 目录辅助
# =====================
ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"


def artifact_path(name: str) -> Path:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    return ARTIFACTS / name