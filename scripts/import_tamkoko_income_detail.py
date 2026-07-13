#!/usr/bin/env python3
"""
Tamkoko | 企迈收入明细表导入脚本

导入企迈收入明细表 CSV 到 brand_tamkoko_ods.income_detail。
沿用 bonjur 的字段映射(channel 枚举、payment_methods[] 等)。

Usage:
    python scripts/import_tamkoko_income_detail.py [csv_file_or_dir]
    python scripts/import_tamkoko_income_detail.py Report/
    python scripts/import_tamkoko_income_detail.py --dry-run
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
    get_connection,
    IngestFileManager,
    insert_batch,
    parse_path,
    setup_cli_parser,
)

SOURCE_TYPE = "income_detail"

CHANNEL_MAP = {
    "微信支付": "WECHAT",
    "支付宝支付": "ALIPAY",
    "美团外卖": "MEITUAN",
    "美团团购券": "MEITUAN",
    "美团在线点": "MEITUAN",
    "淘宝闪购": "TAOBAO",
    "淘宝": "TAOBAO",
    "抖音": "DOUYIN",
    "抖音团购券": "DOUYIN",
    "抖音在线点": "DOUYIN",
}


def get_target_table(brand: str) -> str:
    if brand == "bonjur":
        return "bonjur_ods.income_detail"
    if brand in ("gelatomiiix", "yufeng"):
        return "gelatomiiix_ods.income_detail"
    if brand == "tamkoko":
        return "brand_tamkoko_ods.income_detail"
    raise ValueError(f"Unknown brand: {brand}")


TABLE_DDL = """
CREATE SCHEMA IF NOT EXISTS brand_tamkoko_ods;
CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.income_detail (
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
    CONSTRAINT uq_tamkoko_income_detail UNIQUE (store_code, order_no)
);
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
"""


def strip_backtick(s: str) -> str:
    return s.strip().strip("`")


def to_numeric(s: str) -> float:
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


def map_channel(channel_str: str) -> Optional[str]:
    if not channel_str:
        return None
    s = channel_str.strip()
    return CHANNEL_MAP.get(s, "OTHER")


def main():
    ap = setup_cli_parser("Tamkoko 企迈收入明细表 CSV 导入")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_tamkoko_income_detail.py [csv_file_or_dir]")

    target = Path(args.input)
    if target.is_file():
        files = [target]
    elif target.is_dir():
        files = list(target.glob("*.csv"))
    else:
        print(f"路径不存在: {args.input}", file=sys.stderr)
        sys.exit(1)

    if not files:
        print(f"未找到 CSV 文件: {args.input}", file=sys.stderr)
        sys.exit(1)

    brand_code = args.brand or "tamkoko"
    table = get_target_table(brand_code)
    print(f"目标表: {table}, 文件数: {len(files)}")

    conn = get_connection()
    try:
        for csv_path in files:
            print(f"\n=== {csv_path.name} ===")
            meta = parse_path(str(csv_path), SOURCE_TYPE)
            print(f"  brand={meta['brand_code']}, store={meta['store_code']}, month={meta['month']}")

            rows = []
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    order_no_raw = row.get("订单号") or row.get("order_no") or ""
                    if not order_no_raw:
                        continue
                    rows.append((
                        meta["store_code"],
                        row.get("品牌"),
                        row.get("城市"),
                        row.get("门店名称"),
                        parse_date(row.get("营业日期", "")),
                        strip_backtick(order_no_raw),
                        map_channel(row.get("支付渠道")),
                        to_numeric(row.get("营业额")),
                        to_numeric(row.get("营业净收")),
                        to_numeric(row.get("营业收入")),
                        [p.strip() for p in (row.get("结账方式拆分") or "").split(",") if p.strip()] or None,
                        strip_backtick(row.get("三方支付流水号")) or None,
                        row.get("订单来源"),
                        row.get("订单类型"),
                        csv_path.name,
                    ))

            print(f"  解析行数: {len(rows)}")
            if args.dry_run:
                continue

            file_hash = calculate_sha256(str(csv_path))
            mgr = IngestFileManager(conn)
            existing = mgr.check(file_hash, meta["brand_code"])
            if existing:
                source_file_id = existing["id"]
                mgr.mark_pending(source_file_id, len(rows))
            else:
                source_file_id = mgr.create(
                    meta["brand_code"], meta["store_code"], SOURCE_TYPE,
                    meta["month_date"], meta["file_name"], meta["file_path"],
                    file_hash, csv_path.stat().st_size,
                )
            conn.commit()

            values = [(*r, source_file_id) for r in rows]
            inserted = insert_batch(conn, table, COLUMNS, values, CONFLICT_CLAUSE)
            mgr.mark_success(source_file_id, inserted)
            print(f"  ✅ 导入成功, source_file_id={source_file_id}, rows={inserted}")
    finally:
        conn.close()
