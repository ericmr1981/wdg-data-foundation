#!/usr/bin/env python3
"""gelatomiiix｜收银明细导入脚本

导入收银明细表 XLSX 到 gelatomiiix_ods.cash_register_detail。
支付渠道列（宽表）转置为长表存储。

Path convention: inputs/{brand_code}/{store_code}/cash_register/{YYYY-MM}/{filename}.xlsx
"""

import os
import re
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import openpyxl

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from lib.importer import (
    calculate_sha256,
    ensure_table_exists,
    get_connection,
    IngestFileManager,
    insert_batch,
    parse_path,
    setup_cli_parser,
)

STORE_CODE_DEFAULT = os.getenv("GELATOMIIIX_STORE_CODE", "sh_xtd")
STORE_NAME_DEFAULT = os.getenv("GELATOMIIIX_STORE_NAME", "上海新天地店")
TARGET_TABLE = "gelatomiiix_ods.cash_register_detail"
SOURCE_TYPE = "cash_register"

PAYMENT_COLUMNS = [
    '云闪付', '免支付', '微信支付', '抖音团购券',
    '支付宝支付', '现金支付', '美团团购券', '自定义结账方式'
]

TABLE_DDL = """
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
"""

COLUMNS = [
    "store_code", "store_name", "biz_date", "order_no",
    "gross_amt", "revenue_amt", "discount_amt", "net_amt",
    "txn_qty", "payment_method", "source_file_id",
]

CONFLICT_CLAUSE = """
ON CONFLICT (store_code, order_no) DO UPDATE SET
  store_name = EXCLUDED.store_name, gross_amt = EXCLUDED.gross_amt,
  revenue_amt = EXCLUDED.revenue_amt, discount_amt = EXCLUDED.discount_amt,
  net_amt = EXCLUDED.net_amt, txn_qty = EXCLUDED.txn_qty,
  payment_method = EXCLUDED.payment_method, source_file_id = EXCLUDED.source_file_id
"""


def parse_path_cash_register(file_path: str) -> dict:
    """Parse path with fallback for non-standard paths."""
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
    return parse_path(file_path, SOURCE_TYPE)


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


def delete_existing_by_source(source_file_id: int, conn) -> int:
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {TARGET_TABLE} WHERE source_file_id = %s", (source_file_id,))
        deleted = cur.rowcount
        conn.commit()
        return deleted


def main():
    ap = setup_cli_parser("gelatomiiix 收银明细导入")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_gelatomiiix_cash_register.py [xlsx_file_or_dir]")

    in_path = Path(args.input)
    files = [str(p) for p in in_path.rglob("*.xlsx")] if in_path.is_dir() else [str(in_path)]
    if not files:
        raise SystemExit(f"no xlsx files under: {in_path}")

    conn = get_connection()
    try:
        for fp in sorted(files):
            meta = parse_path_cash_register(fp)
            file_hash = calculate_sha256(fp)
            file_size = os.path.getsize(fp)
            mgr = IngestFileManager(conn)
            existing = mgr.check(file_hash)
            if existing and existing['status'] == 'success':
                print(f"SKIP: {fp}")
                continue
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

            raw = read_xlsx(fp)
            records = transform(raw)
            print(f"FILE: {fp} -> {len(records)} records")
            if args.dry_run:
                mgr.mark_pending(source_file_id, len(records))
                continue

            ensure_table_exists(conn, "gelatomiiix_ods", "cash_register_detail", TABLE_DDL)
            delete_existing_by_source(source_file_id, conn)

            store_code = meta.get("store_code") or STORE_CODE_DEFAULT
            store_name = STORE_NAME_DEFAULT
            seen: set[str] = set()
            deduped = [r for r in records if r['order_no'] not in seen and not seen.add(r['order_no'])]
            values = [
                (store_code, store_name, r['biz_date'], r['order_no'],
                 r['gross_amt'], r['revenue_amt'], r['discount_amt'], r['net_amt'],
                 r['txn_qty'], r['payment_method'], source_file_id)
                for r in deduped
            ]
            inserted = insert_batch(conn, TARGET_TABLE, COLUMNS, values, CONFLICT_CLAUSE)
            mgr.mark_success(source_file_id, inserted)
            print(f"  inserted={inserted} source_file_id={source_file_id}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
