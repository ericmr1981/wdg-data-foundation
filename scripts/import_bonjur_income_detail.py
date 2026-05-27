#!/usr/bin/env python3
"""
Bonjur｜企迈收入明细表导入脚本

导入企迈收入明细表 CSV 到 bonjur_ods.income_detail。
基于 import_gelatomiiix_income_detail.py，但采用 path-driven 架构。

Path convention: inputs/{brand_code}/{store_code}/income_detail/{YYYY-MM}/{filename}.csv

Usage:
    python scripts/import_bonjur_income_detail.py [csv_file]
    python scripts/import_bonjur_income_detail.py --dry-run [csv_file]
"""

import argparse
import csv
import hashlib
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "dataplatform"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD"),
}

BRAND_CODE = "bonjur"
TARGET_TABLE = "bonjur_ods.income_detail"

# 有效第三方支付渠道（存入 payment_methods）
THIRD_PARTY_METHODS = {
    "微信支付",
    "支付宝支付",
    "美团团购券",
    "云闪付",
    "抖音团购券",
}

# 渠道名称映射（CSV 中文 → 枚举编码）
CHANNEL_MAP = {
    "微信支付": "WECHAT",
    "支付宝支付": "ALIPAY",
    "美团外卖": "MEITUAN",
    "美团团购券": "MEITUAN",
    "美团在线点": "MEITUAN",
    "淘宝闪购": "TAOBAO",
    "抖音团购券": "DOUYIN",
    "抖音在线点": "DOUYIN",
    "京东秒送": "JD",
}


def calculate_sha256(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(block)
    return sha256_hash.hexdigest()


def parse_path(file_path: str) -> dict:
    """Parse metadata from file path.
    Path format: inputs/{brand_code}/{store_code}/income_detail/{YYYY-MM}/{filename}
    """
    p = Path(file_path)
    parts = p.parts
    try:
        idx = parts.index("inputs")
    except ValueError:
        raise ValueError(f"Path does not contain 'inputs/' segment: {file_path}")

    brand_code = parts[idx + 1]
    store_code = parts[idx + 2]
    source_type = parts[idx + 3]
    month_str = parts[idx + 4]

    if source_type != "income_detail":
        raise ValueError(f"Unexpected source_type '{source_type}', expected 'income_detail'")
    if not re.match(r"^\d{4}-\d{2}$", month_str):
        raise ValueError(f"Invalid month format in path: {month_str}")

    return {
        "brand_code": brand_code,
        "store_code": store_code,
        "source_type": source_type,
        "month": month_str,
        "month_date": f"{month_str}-01",
        "file_name": p.name,
        "file_path": str(p.resolve()),
    }


def extract_month_from_filename(fname: str) -> Optional[str]:
    """Extract latest year-month from filename.

    Supports:
      '企迈 收入明细表 2025-04-01 至 2025-05-31.csv' -> '2025-05-01'
      '企迈 收入明细表 2025年4月到5月.csv' -> '2025-05-01'
      '企迈 收入明细表 2026年2月到3月.csv' -> '2026-03-01'
    """
    patterns = [
        r"(\d{4})-(\d{2})-\d{2}",       # YYYY-MM-DD
        r"(\d{4})年(\d{1,2})月",         # YYYY年M月
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
    """Map CSV channel name to enum code."""
    if not channel_raw:
        return None
    channel_raw = channel_raw.strip()
    return CHANNEL_MAP.get(channel_raw, "OTHER")


def ensure_table_exists(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema='bonjur_ods' AND table_name='income_detail'
            );
            """
        )
        if cur.fetchone()[0]:
            return

        cur.execute(
            """
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
        )
        conn.commit()


def transform_row(r: dict, source_file: str) -> Optional[dict]:
    """Convert CSV row to DB record."""
    order_no = strip_backtick(r.get("订单号", ""))
    if not order_no:
        return None

    biz_date = parse_date(r.get("营业日期"))
    if biz_date is None:
        return None

    # Payment methods from CSV 结账方式拆分
    raw_split = r.get("结账方式拆分", "").strip()
    payment_methods = []
    if raw_split:
        for item in raw_split.split(","):
            item = item.strip()
            if item in THIRD_PARTY_METHODS:
                payment_methods.append(item)

    # Channel mapping
    channel_raw = r.get("支付渠道", "") or r.get("结账方式名称", "") or ""
    channel = map_channel(channel_raw)

    # Amount fields
    gross_amt = to_numeric(r.get("营业额")) or 0.0
    net_amt = to_numeric(r.get("营业净收")) or 0.0
    revenue_amt = to_numeric(r.get("营业收入")) or 0.0

    # Third party txn no
    third_party_txn_no_raw = r.get("三方支付流水号", "").strip()
    third_party_txn_no = (
        strip_backtick(third_party_txn_no_raw)
        if third_party_txn_no_raw not in ("", "--")
        else None
    )

    return {
        "store_code": None,  # filled from path metadata
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


def check_ingest_file(file_hash: str, conn) -> Optional[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, status, row_count FROM raw.ingest_file WHERE file_hash = %s",
            (file_hash,),
        )
        row = cur.fetchone()
        return {"id": row[0], "status": row[1], "row_count": row[2]} if row else None


def create_ingest_file(meta: dict, file_hash: str, file_size: int, conn) -> int:
    month = extract_month_from_filename(meta["file_name"]) or meta["month_date"]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO raw.ingest_file
              (brand_code, store_code, source_type, month, file_name, file_path, file_hash, file_size, status)
            VALUES (%s, %s, 'income_detail', %s, %s, %s, %s, %s, 'pending')
            RETURNING id
            """,
            (
                meta["brand_code"],
                meta["store_code"],
                month,
                meta["file_name"],
                meta["file_path"],
                file_hash,
                file_size,
            ),
        )
        return cur.fetchone()[0]


def update_ingest_file(source_file_id: int, row_count: int, conn, status: str = "success"):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE raw.ingest_file SET status=%s, row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
            (status, row_count, source_file_id),
        )
        conn.commit()


def insert_rows(records: list[dict], source_file_id: int, store_code: str, conn) -> int:
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in records:
        key = r["order_no"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    values = [
        (
            store_code,
            r["brand_name"],
            r["city"],
            r["store_name"],
            r["biz_date"],
            r["order_no"],
            r["channel"],
            r["gross_amt"],
            r["net_amt"],
            r["revenue_amt"],
            r["payment_methods"],
            r["third_party_txn_no"],
            r["order_source"],
            r["order_type"],
            r["source_file"],
            source_file_id,
        )
        for r in deduped
    ]

    if not values:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""
            INSERT INTO {TARGET_TABLE}
              (store_code, brand_name, city, store_name,
               biz_date, order_no, channel,
               gross_amt, net_amt, revenue_amt,
               payment_methods, third_party_txn_no,
               order_source, order_type,
               source_file, source_file_id)
            VALUES %s
            ON CONFLICT (store_code, order_no) DO UPDATE SET
              brand_name = EXCLUDED.brand_name,
              city = EXCLUDED.city,
              store_name = EXCLUDED.store_name,
              biz_date = EXCLUDED.biz_date,
              channel = EXCLUDED.channel,
              gross_amt = EXCLUDED.gross_amt,
              net_amt = EXCLUDED.net_amt,
              revenue_amt = EXCLUDED.revenue_amt,
              payment_methods = EXCLUDED.payment_methods,
              third_party_txn_no = EXCLUDED.third_party_txn_no,
              order_source = EXCLUDED.order_source,
              order_type = EXCLUDED.order_type,
              source_file = EXCLUDED.source_file,
              source_file_id = EXCLUDED.source_file_id
            """,
            values,
        )
        conn.commit()
    return len(values)


def process_file(fp: str, conn, dry_run: bool) -> dict:
    file_hash = calculate_sha256(fp)
    file_size = os.path.getsize(fp)
    meta = parse_path(fp)

    existing = check_ingest_file(file_hash, conn)
    if existing and existing["status"] == "success":
        print(f"  SKIP (already imported): {Path(fp).name}")
        return {"skipped": True}

    source_file_id = existing["id"] if existing else create_ingest_file(meta, file_hash, file_size, conn)
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
        update_ingest_file(source_file_id, len(rows), conn, "pending")
        return {"name": Path(fp).name, "records": len(rows)}

    ensure_table_exists(conn)
    inserted = insert_rows(rows, source_file_id, meta["store_code"], conn)
    update_ingest_file(source_file_id, inserted, conn)
    print(f"  INSERTED: {Path(fp).name} -> {inserted} records (from {len(rows)} parsed)")
    return {"name": Path(fp).name, "total": len(rows), "inserted": inserted}


def main():
    ap = argparse.ArgumentParser(description="Bonjur 企迈收入明细表 CSV 导入")
    ap.add_argument("input", nargs="?", help="CSV file path")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report without inserting")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_bonjur_income_detail.py [csv_file] [--dry-run]")

    in_path = Path(args.input)
    if in_path.is_dir():
        files = [str(p) for p in sorted(in_path.glob("*.csv")) if "收入明细表" in p.name]
    else:
        files = [str(in_path)]

    if not files:
        raise SystemExit(f"No 收入明细表 CSV files found in: {in_path}")

    print(f"Found {len(files)} CSV file(s)")
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        for fp in files:
            process_file(fp, conn, args.dry_run)
    finally:
        conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
