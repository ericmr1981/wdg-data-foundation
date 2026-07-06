#!/usr/bin/env python3
"""
Tamkoko | 企迈收银明细表导入脚本

导入企迈收银明细表 CSV 到 brand_tamkoko_ods.cash_register_order。
与 income_detail 平行:income_detail 是支付级,本表是订单聚合级。

每行 CSV 是一条订单的一个细分(早市/午市/晚市、堂食/外卖)。
同一订单号可能多行(退款反冲),导入时按订单号 SUM 求净订单入库。

Usage:
    python scripts/import_tamkoko_cash_register.py [csv_file_or_dir]
    python scripts/import_tamkoko_cash_register.py --dry-run
    python scripts/import_tamkoko_cash_register.py --replace {file}
"""

import argparse
import csv
import hashlib
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from _store_guard import (
    CrossBrandStoreError,
    load_valid_stores,
    safe_resolve_store,
)

def _get_db_config() -> dict:
    """Build DB config dict; accesses DB_PASSWORD at call time (fail-fast
    when actually needed). Deferring this from module level makes the
    module importable for pure-function tests in envs without DB creds."""
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
        "database": os.getenv("DB_NAME", "dataplatform"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.environ["DB_PASSWORD"],
    }

STORE_CODE = os.getenv("CASH_REGISTER_STORE_CODE", "sh_sjh")
STORE_NAME = os.getenv("CASH_REGISTER_STORE_NAME", "上海世纪汇店")
BRAND_CODE = os.getenv("CASH_REGISTER_BRAND_CODE", "tamkoko")
SOURCE_TYPE = "cash_register"
TARGET_TABLE = "brand_tamkoko_ods.cash_register_order"


def calculate_sha256(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(4096), b""):
            h.update(block)
    return h.hexdigest()


def strip_backtick(s: str) -> str:
    return s.strip().strip("`")


def to_numeric(s) -> float:
    if s is None or s == "":
        return 0.0
    try:
        return float(str(s).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def parse_date(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_path(file_path: str) -> dict:
    """从路径解析元数据: inputs/{brand}/{store}/sales/cash_register/{YYYY-MM}/{filename}"""
    path = Path(file_path)
    parts = path.parts
    if "inputs" not in parts:
        raise ValueError(f"路径必须包含 'inputs' 目录: {file_path}")
    idx = parts.index("inputs")
    if len(parts) < idx + 5:
        raise ValueError(
            f"路径格式错误: inputs/{{brand}}/{{store}}/sales/cash_register/{{YYYY-MM}}/{{filename}}\n"
            f"实际: {file_path}"
        )
    brand_code = parts[idx + 1]
    store_code = parts[idx + 2]
    # sales/cash_register 两层路径(销售数据 / 子类收银明细)
    sales_type = parts[idx + 3]
    sub_type = parts[idx + 4]
    if sales_type != "sales" or sub_type != SOURCE_TYPE:
        raise ValueError(f"source_type 必须是 'sales/{SOURCE_TYPE}', 实际: {sales_type}/{sub_type}")
    month_str = parts[idx + 5] if len(parts) > idx + 5 else None
    if not month_str or not re.match(r"^\d{4}-\d{2}$", month_str):
        raise ValueError(f"月份格式错误 (需 YYYY-MM): {month_str}")
    return {
        "brand_code": brand_code,
        "store_code": store_code,
        "source_type": SOURCE_TYPE,
        "month": month_str,
        "file_name": path.name,
        "file_path": file_path,
    }


def aggregate_by_order_no(rows: list[dict]) -> list[dict]:
    """按 订单号 SUM 求净订单,跳过 汇总 行

    Args:
        rows: csv.DictReader 解析出的行列表(每行 = 一个订单细分)

    Returns:
        list[dict]: 每个 dict 是一笔净订单,字段:
            order_no, store_name, biz_date, order_source, order_type, meal_period,
            gross_amt, revenue_amt, discount_amt, net_amt, qty
    """
    by_order: dict[str, dict] = {}
    for row in rows:
        first_cell = (row.get("门店名称") or "").strip()
        if "汇总" in first_cell:
            continue
        order_no_raw = (row.get("订单号") or "").strip()
        if not order_no_raw:
            continue
        biz_date = parse_date(row.get("日期", ""))
        if order_no_raw in by_order:
            acc = by_order[order_no_raw]
            acc["gross_amt"] += to_numeric(row.get("营业额"))
            acc["revenue_amt"] += to_numeric(row.get("营业收入"))
            acc["discount_amt"] += to_numeric(row.get("优惠总额"))
            acc["net_amt"] += to_numeric(row.get("营业净收"))
            acc["qty"] += to_numeric(row.get("销量"))
            # store_name / biz_date / order_source / order_type / meal_period 同一订单应一致
            # 不一致记 warn,不阻塞
        else:
            by_order[order_no_raw] = {
                "order_no": order_no_raw,
                "store_name": row.get("门店名称", ""),
                "biz_date": biz_date,
                "order_source": (row.get("订单来源") or "").strip(),
                "order_type": (row.get("订单类型") or "").strip(),
                "meal_period": (row.get("餐段") or "").strip() or None,
                "gross_amt": to_numeric(row.get("营业额")),
                "revenue_amt": to_numeric(row.get("营业收入")),
                "discount_amt": to_numeric(row.get("优惠总额")),
                "net_amt": to_numeric(row.get("营业净收")),
                "qty": to_numeric(row.get("销量")),
            }
    return list(by_order.values())


# ---- 后续 task 添加 ----
def is_already_imported(conn, file_hash: str) -> Optional[int]:
    """查 raw.ingest_file,若 (brand=tamkoko, file_hash=?, status='success') 返回 source_file_id,否则 None"""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id FROM raw.ingest_file
               WHERE brand_code = %s AND file_hash = %s AND status = 'success'
               LIMIT 1""",
            (BRAND_CODE, file_hash),
        )
        row = cur.fetchone()
        return row[0] if row else None


def register_source_file(conn, meta: dict, file_hash: str, file_size: int) -> int:
    """INSERT 一条 raw.ingest_file,status='running',返回 id"""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO raw.ingest_file (
                brand_code, store_code, source_type, month,
                file_name, file_path, file_hash, file_size, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'running')
            ON CONFLICT (file_hash) DO UPDATE SET
                status = 'running', updated_at = NOW()
            RETURNING id""",
            (
                meta["brand_code"], meta["store_code"], SOURCE_TYPE, meta["month"],
                meta["file_name"], meta["file_path"], file_hash, file_size,
            ),
        )
        sf_id = cur.fetchone()[0]
        conn.commit()
        return sf_id


def finalize_source_file(conn, source_file_id: int, row_count: int, status: str = "success"):
    """更新 raw.ingest_file.status / row_count"""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE raw.ingest_file SET status=%s, row_count=%s, finished_at=NOW(), updated_at=NOW() WHERE id=%s",
            (status, row_count, source_file_id),
        )
        conn.commit()


# ---- 后续 task 添加 ----
def replace_existing_for_period(conn, store_code: str, biz_date_sample: str):
    """replace=true 时调用:按 ODS 内 biz_date 年/月删除旧 source_file

    实现:
      1. SELECT DISTINCT source_file_id FROM cash_register_order
         WHERE store_code=? AND date_trunc('month', biz_date) = date_trunc('month', biz_date_sample)
      2. DELETE FROM raw.ingest_file WHERE id IN (...) -- ON DELETE CASCADE 自动清 ODS
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT source_file_id
                 FROM brand_tamkoko_ods.cash_register_order
                WHERE store_code = %s
                  AND date_trunc('month', biz_date) = date_trunc('month', %s::date)""",
            (store_code, biz_date_sample),
        )
        old_ids = [r[0] for r in cur.fetchall()]
        if not old_ids:
            return
        cur.execute(
            "DELETE FROM raw.ingest_file WHERE id = ANY(%s)",
            (old_ids,),
        )
        conn.commit()


# ---- 后续 task 添加 ----
# def import_one_file(...) -> dict
# def main() -> None
