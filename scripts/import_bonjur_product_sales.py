#!/usr/bin/env python3
"""
Bonjur｜商品销售明细导入脚本

导入商品销售明细表 CSV 到 bonjur_ods.product_sales_detail。

Path convention: inputs/{brand_code}/{store_code}/product_sales/{YYYY-MM}/{filename}.csv

Usage:
    python scripts/import_bonjur_product_sales.py [csv_file]
    python scripts/import_bonjur_product_sales.py --dry-run [csv_file]
"""

import os
import re
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import pandas as pd

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from lib.importer import (
    calculate_sha256,
    ensure_table_exists,
    get_db_config,
    IngestFileManager,
    insert_batch,
    load_valid_stores,
    parse_path,
    setup_cli_parser,
)

TARGET_TABLE = "bonjur_ods.product_sales_detail"

COLMAP = {
    '门店名称': 'store_name',
    '日期': 'biz_date',
    '订单号': 'order_no',
    '商品名称': 'product_name',
    '商品原价': 'unit_price',
    '销售数量': 'qty',
    '商品销售额': 'sales_amt',
    '商品实收': 'received_amt',
    '商品优惠': 'discount_amt',
}


TABLE_DDL = """
CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE TABLE IF NOT EXISTS bonjur_ods.product_sales_detail (
  id BIGSERIAL PRIMARY KEY, store_code TEXT NOT NULL, store_name TEXT,
  biz_date DATE NOT NULL, order_no TEXT NOT NULL,
  product_name TEXT NOT NULL, unit_price NUMERIC(14,2),
  qty INT, sales_amt NUMERIC(14,2), received_amt NUMERIC(14,2),
  discount_amt NUMERIC(14,2), order_hour TEXT, source_file_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bonjur_product_sales_detail UNIQUE (store_code, order_no, product_name)
);
CREATE INDEX IF NOT EXISTS idx_bonjur_product_sales_detail_date
  ON bonjur_ods.product_sales_detail(biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_product_sales_detail_store_date
  ON bonjur_ods.product_sales_detail(store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_product_sales_detail_product
  ON bonjur_ods.product_sales_detail(product_name);
"""

COLUMNS = [
    "store_code", "store_name", "biz_date", "order_no", "product_name",
    "unit_price", "qty", "sales_amt", "received_amt", "discount_amt",
    "order_hour", "source_file_id",
]

CONFLICT_CLAUSE = """
ON CONFLICT (store_code, order_no, product_name) DO UPDATE SET
  store_name=EXCLUDED.store_name, unit_price=EXCLUDED.unit_price,
  qty=EXCLUDED.qty, sales_amt=EXCLUDED.sales_amt,
  received_amt=EXCLUDED.received_amt, discount_amt=EXCLUDED.discount_amt,
  order_hour=EXCLUDED.order_hour, source_file_id=EXCLUDED.source_file_id
"""


SOURCE_TYPE = "product_sales"


def to_numeric(v):
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ('--', ''):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def to_int(v):
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip()
    if not s or s in ('--', ''):
        return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def normalize_date(v) -> Optional[date]:
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip()
    if not s or '汇总' in s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def delete_existing_by_source(source_file_id: int, conn) -> int:
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {TARGET_TABLE} WHERE source_file_id = %s", (source_file_id,))
        deleted = cur.rowcount
        conn.commit()
        return deleted


def read_csv(file_path: str) -> pd.DataFrame:
    return pd.read_csv(file_path, encoding='utf-8-sig')


def transform(df: pd.DataFrame) -> list[dict]:
    records = []
    for _, r in df.iterrows():
        biz_date = normalize_date(r.get('日期'))
        if biz_date is None:
            continue

        order_no = str(r.get('订单号', '')).strip().strip('`')
        if not order_no:
            continue

        records.append({
            'store_name': str(r.get('门店名称', '')).strip() or None,
            'biz_date': biz_date,
            'order_no': order_no,
            'product_name': str(r.get('商品名称', '')).strip(),
            'unit_price': to_numeric(r.get('商品原价')),
            'qty': to_int(r.get('销售数量')),
            'sales_amt': to_numeric(r.get('商品销售额')),
            'received_amt': to_numeric(r.get('商品实收')),
            'discount_amt': to_numeric(r.get('商品优惠')),
            'order_hour': str(r.get('小时', '')).strip() or None,
        })
    return records


def process_file(fp: str, conn, dry_run: bool, valid_stores: set[str]) -> dict:
    meta = parse_path(fp, SOURCE_TYPE)

    if meta["store_code"] not in valid_stores:
        raise SystemExit(
            f"FATAL: 文件 {fp} 路径推得 store_code={meta['store_code']!r} (brand={meta['brand_code']!r})，"
            f"不在合法门店集合 {sorted(valid_stores)} 中。"
        )

    file_hash = calculate_sha256(fp)
    file_size = os.path.getsize(fp)

    mgr = IngestFileManager(conn)
    existing = mgr.check(file_hash)
    if existing and existing['status'] == 'success':
        print(f"  SKIP (already imported): {Path(fp).name}")
        return {"skipped": True}

    source_file_id = (
        existing['id']
        if existing
        else mgr.create(
            meta['brand_code'], meta['store_code'], SOURCE_TYPE,
            meta['month_date'], meta['file_name'], meta['file_path'],
            file_hash, file_size,
        )
    )
    conn.commit()

    df = read_csv(fp)
    records = transform(df)
    print(f"  FILE: {Path(fp).name} -> {len(records)} records")

    if dry_run:
        mgr.mark_pending(source_file_id, len(records))
        return {"name": Path(fp).name, "records": len(records)}

    ensure_table_exists(conn, "bonjur_ods", "product_sales_detail", TABLE_DDL)
    delete_existing_by_source(source_file_id, conn)

    seen: set[tuple[str, str]] = set()
    deduped = [r for r in records if (r['order_no'], r['product_name']) not in seen and not seen.add((r['order_no'], r['product_name']))]

    values = [
        (meta["store_code"], r.get('store_name'), r['biz_date'], r['order_no'],
         r['product_name'], r['unit_price'], r['qty'],
         r['sales_amt'], r['received_amt'], r['discount_amt'],
         r.get('order_hour'), source_file_id)
        for r in deduped
    ]
    inserted = insert_batch(conn, TARGET_TABLE, COLUMNS, values, CONFLICT_CLAUSE)
    mgr.mark_success(source_file_id, inserted)
    print(f"  INSERTED: {Path(fp).name} -> {inserted} records")
    return {"name": Path(fp).name, "total": len(records), "inserted": inserted}


def main():
    ap = setup_cli_parser("Bonjur 商品销售明细 CSV 导入")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_bonjur_product_sales.py [csv_file] [--dry-run]")

    in_path = Path(args.input)
    if in_path.is_dir():
        files = [str(p) for p in sorted(in_path.rglob("*.csv"))]
    else:
        files = [str(in_path)]

    if not files:
        raise SystemExit(f"No CSV files found in: {in_path}")

    print(f"Found {len(files)} CSV file(s)")
    conn = psycopg2.connect(**get_db_config())
    try:
        valid_stores = load_valid_stores("bonjur", conn)
        if not valid_stores:
            raise SystemExit("FATAL: ops.stores 中没有 brand=bonjur 的 enabled 门店")
        print(f"Bonjur valid stores: {sorted(valid_stores)}")
        for fp in files:
            process_file(fp, conn, args.dry_run, valid_stores)
    finally:
        conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
