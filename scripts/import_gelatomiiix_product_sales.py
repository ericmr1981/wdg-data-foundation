#!/usr/bin/env python3
"""gelatomiiix｜商品销售明细导入脚本

导入商品销售明细表 CSV 到 gelatomiiix_ods.product_sales_detail。

Path convention: inputs/{brand_code}/{store_code}/product_sales/{YYYY-MM}/{filename}.csv
"""

import argparse, hashlib, os, re
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "dataplatform"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD"),
}

STORE_CODE_DEFAULT = os.getenv("GELATOMIIIX_STORE_CODE", "sh_xtd")
STORE_NAME_DEFAULT = os.getenv("GELATOMIIIX_STORE_NAME", "上海新天地店")
TARGET_TABLE = "gelatomiiix_ods.product_sales_detail"

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


def calculate_sha256(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(block)
    return sha256_hash.hexdigest()


def parse_path(file_path: str) -> dict:
    p = Path(file_path)
    parts = p.parts
    if "inputs" not in parts:
        return {
            "brand_code": "gelatomiiix",
            "store_code": STORE_CODE_DEFAULT,
            "source_type": "product_sales",
            "month": None, "month_date": None,
            "file_name": p.name, "file_path": str(p),
        }
    idx = parts.index("inputs")
    if len(parts) < idx + 5:
        raise ValueError(f"路径格式: inputs/{{brand_code}}/{{store_code}}/product_sales/{{YYYY-MM}}/{{file}}\n实际: {file_path}")
    return {
        "brand_code": parts[idx + 1],
        "store_code": parts[idx + 2],
        "source_type": parts[idx + 3],
        "month": parts[idx + 4],
        "month_date": f"{parts[idx + 4]}-01",
        "file_name": parts[-1],
        "file_path": file_path,
    }


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
        })
    return records


def ensure_table_exists(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (SELECT FROM information_schema.tables
              WHERE table_schema='gelatomiiix_ods' AND table_name='product_sales_detail');
        """)
        if cur.fetchone()[0]:
            return
        cur.execute("""
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
        """)
        conn.commit()


def check_ingest_file(file_hash: str, conn) -> Optional[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, brand_code, store_code, source_type, month, status, row_count FROM raw.ingest_file WHERE file_hash = %s",
            (file_hash,))
        row = cur.fetchone()
        return {"id": row[0], "status": row[5]} if row else None


def create_ingest_file(meta: dict, file_hash: str, file_size: int, conn) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO raw.ingest_file (brand_code,store_code,source_type,month,file_name,file_path,file_hash,file_size,status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending') RETURNING id
        """, (meta['brand_code'], meta['store_code'], meta['source_type'],
              meta['month_date'], meta['file_name'], meta['file_path'], file_hash, file_size))
        return cur.fetchone()[0]


def update_ingest_file_success(source_file_id: int, row_count: int, conn):
    with conn.cursor() as cur:
        cur.execute("UPDATE raw.ingest_file SET status='success', row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
                    (row_count, source_file_id))
        conn.commit()


def delete_existing_by_source(source_file_id: int, conn) -> int:
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {TARGET_TABLE} WHERE source_file_id = %s", (source_file_id,))
        deleted = cur.rowcount
        conn.commit()
        return deleted


def insert_rows(records: list[dict], meta: dict, source_file_id: int, conn) -> int:
    store_code = meta.get("store_code") or STORE_CODE_DEFAULT
    store_name = STORE_NAME_DEFAULT
    # Dedup by (order_no, product_name) to avoid ON CONFLICT errors
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for r in records:
        key = (r['order_no'], r['product_name'])
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    values = [
        (store_code, store_name, r['biz_date'], r['order_no'],
         r['product_name'], r['unit_price'], r['qty'],
         r['sales_amt'], r['received_amt'], r['discount_amt'], source_file_id)
        for r in deduped
    ]
    if not values:
        return 0
    with conn.cursor() as cur:
        execute_values(cur, f"""
            INSERT INTO {TARGET_TABLE}
              (store_code,store_name,biz_date,order_no,product_name,unit_price,qty,sales_amt,received_amt,discount_amt,source_file_id)
            VALUES %s
            ON CONFLICT (store_code, order_no, product_name) DO UPDATE SET
              store_name=EXCLUDED.store_name, unit_price=EXCLUDED.unit_price,
              qty=EXCLUDED.qty, sales_amt=EXCLUDED.sales_amt,
              received_amt=EXCLUDED.received_amt, discount_amt=EXCLUDED.discount_amt,
              source_file_id=EXCLUDED.source_file_id
        """, values)
        conn.commit()
    return len(values)


def main():
    ap = argparse.ArgumentParser(description="gelatomiiix 商品销售明细导入")
    ap.add_argument("input", help="csv file or directory")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    in_path = Path(args.input)
    files = [str(p) for p in in_path.rglob("*.csv")] if in_path.is_dir() else [str(in_path)]
    if not files:
        raise SystemExit(f"no csv files under: {in_path}")

    conn = psycopg2.connect(**DB_CONFIG)
    try:
        ensure_table_exists(conn)
        for fp in sorted(files):
            meta = parse_path(fp)
            file_hash = calculate_sha256(fp)
            file_size = os.path.getsize(fp)
            existing = check_ingest_file(file_hash, conn)
            if existing and existing['status'] == 'success':
                print(f"SKIP: {fp}")
                continue
            source_file_id = existing['id'] if existing else create_ingest_file(meta, file_hash, file_size, conn)
            conn.commit()

            df = read_csv(fp)
            records = transform(df)
            print(f"FILE: {fp} -> {len(records)} records")
            if args.dry_run:
                continue
            delete_existing_by_source(source_file_id, conn)
            inserted = insert_rows(records, meta, source_file_id, conn)
            update_ingest_file_success(source_file_id, inserted, conn)
            print(f"  inserted={inserted}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
