#!/usr/bin/env python3
"""gelatomiiix｜商品销售明细导入脚本

导入商品销售明细表 CSV 到 gelatomiiix_ods.product_sales_detail。

Path convention: inputs/{brand_code}/{store_code}/product_sales/{YYYY-MM}/{filename}.csv
"""

import os
import re
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import pandas as pd
import psycopg2

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

STORE_CODE_DEFAULT = os.getenv("GELATOMIIIX_STORE_CODE", "sh_xtd")
STORE_NAME_DEFAULT = os.getenv("GELATOMIIIX_STORE_NAME", "上海新天地店")
TARGET_TABLE = "gelatomiiix_ods.product_sales_detail"
SOURCE_TYPE = "product_sales"

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
CREATE SCHEMA IF NOT EXISTS gelatomiiix_ods;
CREATE TABLE IF NOT EXISTS gelatomiiix_ods.product_sales_detail (
  id BIGSERIAL PRIMARY KEY, store_code TEXT NOT NULL, store_name TEXT,
  biz_date DATE NOT NULL, order_no TEXT NOT NULL,
  product_name TEXT NOT NULL, unit_price NUMERIC(14,2),
  qty INT, sales_amt NUMERIC(14,2), received_amt NUMERIC(14,2),
  discount_amt NUMERIC(14,2), source_file_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_gelatomiiix_product_sales_detail UNIQUE (store_code, order_no, product_name)
);
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


def parse_path_gelato(file_path: str) -> dict:
    """Parse path with fallback to env defaults."""
    p = Path(file_path)
    parts = p.parts
    if "inputs" not in parts:
        return {
            "brand_code": "gelatomiiix",
            "store_code": STORE_CODE_DEFAULT,
            "source_type": SOURCE_TYPE,
            "month": None, "month_date": None,
            "file_name": p.name, "file_path": str(p),
        }
    try:
        return parse_path(file_path, SOURCE_TYPE)
    except ValueError:
        raise ValueError(f"路径格式: inputs/{{brand_code}}/{{store_code}}/product_sales/{{YYYY-MM}}/{{file}}\n实际: {file_path}")


def to_numeric(v):
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ('--', ''):
        return None
    try:
        return float(s)
    except:
        return None


def to_int(v):
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip()
    if not s or s in ('--', ''):
        return None
    try:
        return int(float(s))
    except:
        return None


def normalize_date(v) -> Optional[date]:
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip()
    if not s or '汇总' in s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except:
        return None


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


def delete_existing_by_source(source_file_id: int, conn) -> int:
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {TARGET_TABLE} WHERE source_file_id = %s", (source_file_id,))
        deleted = cur.rowcount
        conn.commit()
        return deleted


def main():
    ap = setup_cli_parser("gelatomiiix 商品销售明细导入")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_gelatomiiix_product_sales.py [csv_file_or_dir]")

    in_path = Path(args.input)
    files = [str(p) for p in in_path.rglob("*.csv")] if in_path.is_dir() else [str(in_path)]
    if not files:
        raise SystemExit(f"no csv files under: {in_path}")

    conn = psycopg2.connect(**get_db_config())
    try:
        valid_stores_cache: dict[str, set[str]] = {}
        for fp in sorted(files):
            meta = parse_path_gelato(fp)
            brand = meta["brand_code"]
            if brand not in valid_stores_cache:
                valid_stores_cache[brand] = load_valid_stores(brand, conn)
            valid = valid_stores_cache[brand]
            if not valid:
                raise SystemExit(
                    f"FATAL: ops.stores 中没有 brand={brand!r} 的 enabled 门店"
                )
            if meta["store_code"] not in valid:
                raise SystemExit(
                    f"FATAL: 文件 {fp} 路径推得 store_code={meta['store_code']!r}，"
                    f"不属于 brand={brand!r} 合法集合 {sorted(valid)}。"
                )
            file_hash = calculate_sha256(fp)
            file_size = os.path.getsize(fp)
            mgr = IngestFileManager(conn)
            existing = mgr.check(file_hash)
            if existing and existing['status'] == 'success':
                print(f"SKIP: {fp}")
                continue
            month = meta.get("month_date") or f"{datetime.now().strftime('%Y-%m')}-01"
            source_file_id = (
                existing['id']
                if existing
                else mgr.create(
                    meta['brand_code'], meta['store_code'], SOURCE_TYPE,
                    meta.get('month_date') or f"{datetime.now().strftime('%Y-%m')}-01",
                    meta['file_name'], meta['file_path'], file_hash, file_size,
                )
            )
            conn.commit()

            df = read_csv(fp)
            records = transform(df)
            print(f"FILE: {fp} -> {len(records)} records")
            if args.dry_run:
                mgr.mark_pending(source_file_id, len(records))
                continue

            ensure_table_exists(conn, "gelatomiiix_ods", "product_sales_detail", TABLE_DDL)
            delete_existing_by_source(source_file_id, conn)

            store_code = meta.get("store_code") or STORE_CODE_DEFAULT
            store_name = STORE_NAME_DEFAULT
            seen: set[tuple[str, str]] = set()
            deduped = [r for r in records if (r['order_no'], r['product_name']) not in seen and not seen.add((r['order_no'], r['product_name']))]
            values = [
                (store_code, store_name, r['biz_date'], r['order_no'],
                 r['product_name'], r['unit_price'], r['qty'],
                 r['sales_amt'], r['received_amt'], r['discount_amt'],
                 r.get('order_hour'), source_file_id)
                for r in deduped
            ]
            inserted = insert_batch(conn, TARGET_TABLE, COLUMNS, values, CONFLICT_CLAUSE)
            mgr.mark_success(source_file_id, inserted)
            print(f"  inserted={inserted}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
