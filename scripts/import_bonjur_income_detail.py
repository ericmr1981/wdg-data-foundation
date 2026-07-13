#!/usr/bin/env python3
"""
Bonjur｜企迈收入明细表导入脚本

Path convention: inputs/{brand_code}/{store_code}/income_detail/{YYYY-MM}/{filename}.csv

Usage:
    python scripts/import_bonjur_income_detail.py [csv_file_or_dir] [--dry-run]
"""

import csv
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from lib.importer import (
    calculate_sha256,
    ensure_table_exists,
    get_db_config,
    get_connection,
    IngestFileManager,
    insert_batch,
    load_valid_stores,
    parse_path,
    setup_cli_parser,
)

BRAND_CODE = "bonjur"
TARGET_TABLE = "bonjur_ods.income_detail"
SOURCE_TYPE = "income_detail"

THIRD_PARTY_METHODS = {
    "微信支付", "支付宝支付", "美团团购券", "云闪付",
    "抖音团购券", "淘宝闪购支付", "京东秒送支付",
    "美团外卖支付", "美团在线点单", "现金支付",
}

CHANNEL_MAP = {
    "微信支付": "WECHAT", "支付宝支付": "ALIPAY",
    "线下支付宝": "ALIPAY", "美团外卖支付": "MEITUAN",
    "美团团购券": "MEITUAN", "美团在线点单": "MEITUAN",
    "淘宝闪购支付": "TAOBAO", "抖音团购券": "DOUYIN",
    "京东支付": "JD", "京东秒送支付": "JD",
    "云闪付": "UNIONPAY", "现金支付": "CASH",
    "银行卡": "CASH", "线下微信": "WECHAT",
}

TABLE_DDL = """
CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE TABLE IF NOT EXISTS bonjur_ods.income_detail (
    id                  BIGSERIAL PRIMARY KEY,
    store_code          TEXT NOT NULL,
    brand_name          TEXT,
    city                TEXT,
    store_name          TEXT,
    biz_date            DATE NOT NULL,
    order_no            TEXT NOT NULL,
    channel             TEXT,
    gross_amt           NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_amt             NUMERIC(14,2) NOT NULL DEFAULT 0,
    revenue_amt         NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_methods     TEXT[],
    third_party_txn_no  TEXT,
    order_source        TEXT,
    order_type          TEXT,
    source_file         TEXT,
    source_file_id      BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_bonjur_income_detail UNIQUE (store_code, order_no)
);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_biz_date
    ON bonjur_ods.income_detail (biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_store_biz_date
    ON bonjur_ods.income_detail (store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_channel
    ON bonjur_ods.income_detail (channel);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_third_party_txn
    ON bonjur_ods.income_detail (third_party_txn_no);
"""

COLUMNS = [
    "store_code", "brand_name", "city", "store_name",
    "biz_date", "order_no", "channel",
    "gross_amt", "net_amt", "revenue_amt",
    "payment_methods", "third_party_txn_no",
    "order_source", "order_type",
    "source_file", "source_file_id",
]

CONFLICT_CLAUSE = """
ON CONFLICT (store_code, order_no) DO UPDATE SET
    brand_name = EXCLUDED.brand_name, city = EXCLUDED.city,
    store_name = EXCLUDED.store_name, biz_date = EXCLUDED.biz_date,
    channel = EXCLUDED.channel, gross_amt = EXCLUDED.gross_amt,
    net_amt = EXCLUDED.net_amt, revenue_amt = EXCLUDED.revenue_amt,
    payment_methods = EXCLUDED.payment_methods,
    third_party_txn_no = EXCLUDED.third_party_txn_no,
    order_source = EXCLUDED.order_source, order_type = EXCLUDED.order_type,
    source_file = EXCLUDED.source_file, source_file_id = EXCLUDED.source_file_id
"""


def extract_month_from_filename(fname: str) -> Optional[str]:
    patterns = [
        r"(\d{4})-(\d{2})-\d{2}",
        r"(\d{4})年(\d{1,2})月",
    ]
    candidates = []
    for pat in patterns:
        for m in re.finditer(pat, fname):
            year = int(m.group(1))
            month = int(m.group(2))
            if 1 <= month <= 12:
                candidates.append((year, month))
    if not candidates:
        return None
    year, month = max(candidates)
    return f"{year:04d}-{month:02d}-01"


def strip_backtick(s: str) -> str:
    return s.strip().strip("`")


def to_numeric(s: str) -> Optional[float]:
    if s is None:
        return None
    s = str(s).strip().replace(",", "")
    if not s or s in ("--", ""):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def parse_date(s: str) -> Optional[datetime]:
    if not s or s.strip() in ("--", ""):
        return None
    s = s.strip()
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except ValueError:
        return None


def map_channel(channel_raw: Optional[str]) -> Optional[str]:
    if not channel_raw:
        return None
    return CHANNEL_MAP.get(channel_raw.strip(), "OTHER")


def transform_row(r: dict, source_file: str) -> Optional[dict]:
    order_no = strip_backtick(r.get("订单号", ""))
    if not order_no:
        return None
    biz_date = parse_date(r.get("营业日期"))
    if biz_date is None:
        return None

    raw_split = r.get("结账方式拆分", "").strip()
    payment_methods = [
        item.strip() for item in raw_split.split(",")
        if item.strip() in THIRD_PARTY_METHODS
    ]

    channel = map_channel(r.get("支付渠道", "") or r.get("结账方式名称", "") or "")
    gross_amt = to_numeric(r.get("营业额")) or 0.0
    net_amt = to_numeric(r.get("营业净收")) or 0.0
    revenue_amt = to_numeric(r.get("营业收入")) or 0.0

    third_party_txn_no_raw = r.get("三方支付流水号", "").strip()
    third_party_txn_no = (
        strip_backtick(third_party_txn_no_raw)
        if third_party_txn_no_raw not in ("", "--")
        else None
    )

    return {
        "store_code": None,
        "brand_name": r.get("品牌", "").strip() or None,
        "city": r.get("城市", "").strip() or None,
        "store_name": r.get("门店名称", "").strip() or None,
        "biz_date": biz_date.date(),
        "order_no": order_no,
        "channel": channel,
        "gross_amt": gross_amt,
        "net_amt": net_amt,
        "revenue_amt": revenue_amt,
        "payment_methods": payment_methods if payment_methods else None,
        "third_party_txn_no": third_party_txn_no,
        "order_source": r.get("订单来源", "").strip() or None,
        "order_type": r.get("订单类型", "").strip() or None,
        "source_file": source_file,
    }


def process_file(fp: str, conn, dry_run: bool, valid_stores: set[str]) -> dict:
    file_hash = calculate_sha256(fp)
    file_size = os.path.getsize(fp)
    meta = parse_path(fp, SOURCE_TYPE)

    if meta["store_code"] not in valid_stores:
        raise SystemExit(
            f"FATAL: 文件 {fp} store_code={meta['store_code']!r} 不在合法门店集合中"
        )

    mgr = IngestFileManager(conn)
    existing = mgr.check(file_hash)
    if existing and existing["status"] == "success":
        print(f"  SKIP (already imported): {Path(fp).name}")
        return {"skipped": True}

    month = extract_month_from_filename(meta["file_name"]) or meta["month_date"]
    source_file_id = (
        existing["id"]
        if existing
        else mgr.create(
            meta["brand_code"], meta["store_code"], SOURCE_TYPE,
            month, meta["file_name"], meta["file_path"],
            file_hash, file_size,
        )
    )
    conn.commit()

    rows = []
    with open(fp, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            row = transform_row(r, meta["file_path"])
            if row:
                row["store_code"] = meta["store_code"]
                rows.append(row)

    if dry_run:
        print(f"  DRY-RUN: {Path(fp).name} -> {len(rows)} records")
        mgr.mark_pending(source_file_id, len(rows))
        return {"name": Path(fp).name, "records": len(rows)}

    ensure_table_exists(conn, "bonjur_ods", "income_detail", TABLE_DDL)

    seen: set[str] = set()
    deduped = [r for r in rows if r["order_no"] not in seen and not seen.add(r["order_no"])]

    values = [
        (
            r["store_code"], r["brand_name"], r["city"], r["store_name"],
            r["biz_date"], r["order_no"], r["channel"],
            r["gross_amt"], r["net_amt"], r["revenue_amt"],
            r["payment_methods"], r["third_party_txn_no"],
            r["order_source"], r["order_type"],
            r["source_file"], source_file_id,
        )
        for r in deduped
    ]

    inserted = insert_batch(conn, TARGET_TABLE, COLUMNS, values, CONFLICT_CLAUSE)
    mgr.mark_success(source_file_id, inserted)
    print(f"  INSERTED: {Path(fp).name} -> {inserted} records (from {len(rows)} parsed)")
    return {"name": Path(fp).name, "total": len(rows), "inserted": inserted}


def main():
    ap = setup_cli_parser("Bonjur 企迈收入明细表 CSV 导入")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_bonjur_income_detail.py [csv_file_or_dir]")

    in_path = Path(args.input)
    if in_path.is_dir():
        files = [str(p) for p in sorted(in_path.glob("*.csv")) if "收入明细表" in p.name]
    else:
        files = [str(in_path)]

    if not files:
        raise SystemExit(f"No 收入明细表 CSV files found in: {in_path}")

    print(f"Found {len(files)} CSV file(s)")
    conn = get_connection()
    try:
        valid_stores = load_valid_stores(BRAND_CODE, conn)
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
