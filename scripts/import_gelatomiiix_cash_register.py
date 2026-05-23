#!/usr/bin/env python3
"""gelatomiiix｜收银明细导入脚本

导入收银明细表 XLSX 到 gelatomiiix_ods.cash_register_detail。
支付渠道列（宽表）转置为长表存储。

Path convention: inputs/{brand_code}/{store_code}/cash_register/{YYYY-MM}/{filename}.xlsx
"""

import argparse, hashlib, os, re
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import openpyxl
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
TARGET_TABLE = "gelatomiiix_ods.cash_register_detail"

PAYMENT_COLUMNS = [
    '云闪付', '免支付', '微信支付', '抖音团购券',
    '支付宝支付', '现金支付', '美团团购券', '自定义结账方式'
]


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
            "source_type": "cash_register",
            "month": None, "month_date": None,
            "file_name": p.name, "file_path": str(p),
        }
    idx = parts.index("inputs")
    if len(parts) < idx + 5:
        raise ValueError(f"路径格式: inputs/{{brand_code}}/{{store_code}}/cash_register/{{YYYY-MM}}/{{file}}\n实际: {file_path}")
    brand_code = parts[idx + 1]
    store_code = parts[idx + 2]
    source_type = parts[idx + 3]
    month_str = parts[idx + 4]
    if not re.match(r"^\d{4}-\d{2}$", month_str):
        raise ValueError(f"月份格式错误: {month_str}")
    return {
        "brand_code": brand_code, "store_code": store_code,
        "source_type": source_type, "month": month_str,
        "month_date": f"{month_str}-01",
        "file_name": parts[-1], "file_path": file_path,
    }


def extract_payment_method(row: dict) -> Optional[str]:
    for col in PAYMENT_COLUMNS:
        val = row.get(col, '')
        if val is not None and str(val).strip() not in ('', '0', '0.0'):
            return col
    return None


def to_numeric(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ('--', ''):
        return None
    try:
        return float(s)
    except:
        return None


def to_int(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s or s in ('--', ''):
        return None
    try:
        return int(float(s))
    except:
        return None


def normalize_date(v) -> Optional[date]:
    if v is None:
        return None
    s = str(v).strip()
    if not s or '汇总' in s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except:
        return None


def read_xlsx(file_path: str) -> list[dict]:
    wb = openpyxl.load_workbook(file_path, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    main_headers = [str(h).strip() if h else '' for h in rows[0]]
    pay_headers = [str(h).strip() if h else '' for h in (rows[1] if len(rows) > 1 else [])]

    cols = []
    for i, mh in enumerate(main_headers):
        if mh and mh != '收入构成':
            cols.append(mh)
        elif i < len(pay_headers) and pay_headers[i]:
            cols.append(pay_headers[i])
        else:
            cols.append(f'col_{i}')

    data = []
    for row in rows[2:]:
        d = {}
        for i, val in enumerate(row):
            if i < len(cols):
                d[cols[i]] = val
        if any(v is not None and str(v).strip() for v in row):
            data.append(d)
    return data


def transform(records: list[dict]) -> list[dict]:
    out = []
    for r in records:
        biz_date = normalize_date(r.get('日期'))
        if biz_date is None:
            continue

        payment_method = extract_payment_method(r)
        out.append({
            'biz_date': biz_date,
            'order_no': str(r.get('订单号', '')).strip().strip('`'),
            'gross_amt': to_numeric(r.get('营业额')),
            'revenue_amt': to_numeric(r.get('营业收入')),
            'discount_amt': to_numeric(r.get('优惠总额')),
            'net_amt': to_numeric(r.get('营业净收')),
            'txn_qty': to_int(r.get('销量')),
            'payment_method': payment_method,
        })
    return out


def ensure_table_exists(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (SELECT FROM information_schema.tables
              WHERE table_schema='gelatomiiix_ods' AND table_name='cash_register_detail');
        """)
        if cur.fetchone()[0]:
            return
        cur.execute("""
            CREATE SCHEMA IF NOT EXISTS gelatomiiix_ods;
            CREATE TABLE IF NOT EXISTS gelatomiiix_ods.cash_register_detail (
              id BIGSERIAL PRIMARY KEY, store_code TEXT NOT NULL, store_name TEXT,
              biz_date DATE NOT NULL, order_no TEXT NOT NULL,
              gross_amt NUMERIC(14,2), revenue_amt NUMERIC(14,2),
              discount_amt NUMERIC(14,2), net_amt NUMERIC(14,2),
              txn_qty INT, payment_method TEXT,
              source_file_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              CONSTRAINT uq_gelatomiiix_cash_register_detail UNIQUE (store_code, order_no)
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
            INSERT INTO raw.ingest_file
              (brand_code, store_code, source_type, month, file_name, file_path, file_hash, file_size, status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending')
            RETURNING id
        """, (meta['brand_code'], meta['store_code'], meta['source_type'],
              meta['month_date'], meta['file_name'], meta['file_path'],
              file_hash, file_size))
        return cur.fetchone()[0]


def update_ingest_file_success(source_file_id: int, row_count: int, conn):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE raw.ingest_file SET status='success', row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
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
    values = [
        (store_code, store_name, r['biz_date'], r['order_no'],
         r['gross_amt'], r['revenue_amt'], r['discount_amt'], r['net_amt'],
         r['txn_qty'], r['payment_method'], source_file_id)
        for r in records
    ]
    if not values:
        return 0
    with conn.cursor() as cur:
        execute_values(cur, f"""
            INSERT INTO {TARGET_TABLE}
              (store_code, store_name, biz_date, order_no, gross_amt, revenue_amt, discount_amt, net_amt, txn_qty, payment_method, source_file_id)
            VALUES %s
            ON CONFLICT (store_code, order_no) DO UPDATE SET
              store_name = EXCLUDED.store_name, gross_amt = EXCLUDED.gross_amt,
              revenue_amt = EXCLUDED.revenue_amt, discount_amt = EXCLUDED.discount_amt,
              net_amt = EXCLUDED.net_amt, txn_qty = EXCLUDED.txn_qty,
              payment_method = EXCLUDED.payment_method, source_file_id = EXCLUDED.source_file_id
        """, values)
        conn.commit()
    return len(values)


def main():
    ap = argparse.ArgumentParser(description="gelatomiiix 收银明细导入")
    ap.add_argument("input", help="xlsx file or directory")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    in_path = Path(args.input)
    files = [str(p) for p in in_path.rglob("*.xlsx")] if in_path.is_dir() else [str(in_path)]
    if not files:
        raise SystemExit(f"no xlsx files under: {in_path}")

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

            raw = read_xlsx(fp)
            records = transform(raw)
            print(f"FILE: {fp} -> {len(records)} records")
            if args.dry_run:
                continue
            delete_existing_by_source(source_file_id, conn)
            inserted = insert_rows(records, meta, source_file_id, conn)
            update_ingest_file_success(source_file_id, inserted, conn)
            print(f"  inserted={inserted} source_file_id={source_file_id}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
