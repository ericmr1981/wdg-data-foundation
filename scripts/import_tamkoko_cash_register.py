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
    # month in ingest_file expects YYYY-MM-DD format, convert from YYYY-MM
    month_date = f"{meta['month']}-01"
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO raw.ingest_file (
                brand_code, store_code, source_type, month,
                file_name, file_path, file_hash, file_size, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'running')
            ON CONFLICT (brand_code, file_hash) DO UPDATE SET
                status = 'running', updated_at = NOW()
            RETURNING id""",
            (
                meta["brand_code"], meta["store_code"], SOURCE_TYPE, month_date,
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


def import_one_file(conn, meta: dict, replace: bool = False) -> dict:
    """导入单文件到 ODS。返回值:
        {
            "source_file_id": int,
            "row_count": int,
            "skipped": bool,
        }
    """
    file_hash = calculate_sha256(meta["file_path"])
    existing_id = is_already_imported(conn, file_hash)
    if existing_id is not None:
        return {"source_file_id": existing_id, "row_count": 0, "skipped": True}

    # 读 + 聚合
    with open(meta["file_path"], "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    aggregated = aggregate_by_order_no(rows)

    # store-guard:store_name 与 env 不一致 → warn + 仍继续
    if aggregated:
        actual_name = aggregated[0]["store_name"]
        expected_name = STORE_NAME
        if actual_name != expected_name:
            print(
                f"⚠️  store_name 不一致: file={actual_name!r} env={expected_name!r} → 继续入库",
                file=sys.stderr,
            )

    file_size = Path(meta["file_path"]).stat().st_size
    source_file_id = register_source_file(conn, meta, file_hash, file_size)

    # replace=true 时清同月份旧 source_file(CASCADE 清 ODS)
    if replace and aggregated:
        # 用第一条记录的 biz_date 判定月份
        sample_biz = aggregated[0]["biz_date"]
        if sample_biz:
            replace_existing_for_period(conn, meta["store_code"], sample_biz)

    # 写 ODS
    if aggregated:
        with conn.cursor() as cur:
            execute_values(
                cur,
                f"""INSERT INTO {TARGET_TABLE} (
                    store_code, store_name, biz_date, order_no,
                    order_source, order_type, meal_period,
                    gross_amt, revenue_amt, discount_amt, net_amt, qty,
                    source_file_id
                ) VALUES %s""",
                [(
                    meta["store_code"], r["store_name"], r["biz_date"], r["order_no"],
                    r["order_source"], r["order_type"], r["meal_period"],
                    r["gross_amt"], r["revenue_amt"], r["discount_amt"], r["net_amt"], r["qty"],
                    source_file_id,
                ) for r in aggregated],
            )
            conn.commit()

    finalize_source_file(conn, source_file_id, len(aggregated), "success")
    return {"source_file_id": source_file_id, "row_count": len(aggregated), "skipped": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="CSV 文件或目录路径")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--replace", action="store_true",
                        help="按 ODS 内 biz_date 年/月删除同 store+月份旧 source_file 后再写")
    parser.add_argument("--brand", default=BRAND_CODE)
    args = parser.parse_args()

    target = Path(args.path)
    if target.is_file():
        files = [target]
    elif target.is_dir():
        files = sorted(target.glob("*.csv"))
    else:
        print(f"路径不存在: {args.path}", file=sys.stderr)
        sys.exit(1)
    if not files:
        print(f"未找到 CSV 文件: {args.path}", file=sys.stderr)
        sys.exit(1)

    print(f"目标表: {TARGET_TABLE}, 文件数: {len(files)}, replace={args.replace}")

    conn = psycopg2.connect(**_get_db_config())
    try:
        for csv_path in files:
            print(f"\n=== {csv_path.name} ===")
            try:
                meta = parse_path(str(csv_path))
            except ValueError as e:
                print(f"  ❌ 路径解析失败: {e}", file=sys.stderr)
                continue
            print(f"  brand={meta['brand_code']}, store={meta['store_code']}, month={meta['month']}")

            if args.dry_run:
                with open(csv_path, "r", encoding="utf-8-sig") as f:
                    n = sum(1 for _ in csv.DictReader(f))
                print(f"  [dry-run] 跳过,文件有 {n} 行")
                continue

            try:
                result = import_one_file(conn, meta, replace=args.replace)
                if result["skipped"]:
                    print(f"  ⏭ SKIPPED (已导入过, source_file_id={result['source_file_id']})")
                else:
                    print(f"  ✅ 导入成功, source_file_id={result['source_file_id']}, rows={result['row_count']}")
            except Exception as e:
                print(f"  ❌ 导入失败: {e}", file=sys.stderr)
                sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
