#!/usr/bin/env python3
"""Bonjur｜营业数据（自助下载明细）导入脚本（日粒度）

Purpose
- Import the self-service sales daily CSV into `bonjur_ods.sales_daily_self_service`.
- Keep idempotency via `raw.ingest_file` (file_hash) + delete-by-source_file_id.

Path convention (recommended)
- inputs/{brand_code}/{store_code}/sales/{YYYY-MM}/{filename}.csv
  - brand_code: bonjur
  - store_code: e.g. wz_oh_wxc
  - source_type: sales

Notes
- The file may contain a trailing summary row with 时间='汇总：' — it will be skipped.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from lib.importer import (
    calculate_sha256,
    delete_imported_data,
    ensure_table_exists,
    get_connection,
    IngestFileManager,
    insert_batch,
    parse_path,
    setup_cli_parser,
)

STORE_CODE_DEFAULT = os.getenv("BONJUR_STORE_CODE", "wz_oh_wxc")
STORE_NAME_DEFAULT = os.getenv("BONJUR_STORE_NAME", "温州瓯海万象城店")

TARGET_TABLE = "bonjur_ods.sales_daily_self_service"
SOURCE_TYPE = "sales"

TABLE_DDL = """
CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE TABLE IF NOT EXISTS bonjur_ods.sales_daily_self_service (
  id bigserial primary key,
  store_code text not null,
  store_name text,
  biz_date date not null,
  month date not null,

  gross_sales_amt numeric(14,2),
  revenue_amt numeric(14,2),
  order_cnt int,
  refund_amt numeric(14,2),
  revenue_incl_service_fee_amt numeric(14,2),
  platform_service_fee_amt numeric(14,2),

  wechat_pay_gross_amt numeric(14,2),
  wechat_pay_revenue_amt numeric(14,2),
  wechat_pay_cnt int,
  wechat_pay_miniapp_gross_amt numeric(14,2),
  wechat_pay_miniapp_revenue_amt numeric(14,2),
  wechat_pay_pos_gross_amt numeric(14,2),
  wechat_pay_pos_revenue_amt numeric(14,2),

  alipay_pay_gross_amt numeric(14,2),
  alipay_pay_revenue_amt numeric(14,2),
  alipay_pay_cnt int,
  alipay_pay_miniapp_gross_amt numeric(14,2),
  alipay_pay_miniapp_revenue_amt numeric(14,2),
  alipay_pay_pos_gross_amt numeric(14,2),
  alipay_pay_pos_revenue_amt numeric(14,2),

  cash_pay_gross_amt numeric(14,2),
  cash_pay_revenue_amt numeric(14,2),
  cash_pay_cnt int,

  meituan_delivery_gross_amt numeric(14,2),
  meituan_delivery_revenue_amt numeric(14,2),
  meituan_delivery_cnt int,

  taobao_shangou_gross_amt numeric(14,2),
  taobao_shangou_revenue_amt numeric(14,2),
  taobao_shangou_cnt int,

  jd_miaosong_gross_amt numeric(14,2),
  jd_miaosong_revenue_amt numeric(14,2),
  jd_miaosong_cnt int,

  meituan_coupon_cnt int,
  meituan_coupon_gross_amt numeric(14,2),
  meituan_coupon_revenue_amt numeric(14,2),

  douyin_coupon_cnt int,
  douyin_coupon_gross_amt numeric(14,2),
  douyin_coupon_revenue_amt numeric(14,2),

  alipay_coupon_cnt int,
  alipay_coupon_gross_amt numeric(14,2),
  alipay_coupon_revenue_amt numeric(14,2),

  meituan_online_gross_amt numeric(14,2),
  meituan_online_revenue_amt numeric(14,2),
  meituan_online_discount_amt numeric(14,2),

  douyin_online_cnt int,
  douyin_online_gross_amt numeric(14,2),
  douyin_online_revenue_amt numeric(14,2),

  source_file_id bigint,
  created_at timestamptz not null default now(),

  constraint uq_bonjur_sales_daily_self_service unique (store_code, biz_date)
);
CREATE INDEX IF NOT EXISTS idx_bonjur_sales_daily_self_service_month ON bonjur_ods.sales_daily_self_service(month);
CREATE INDEX IF NOT EXISTS idx_bonjur_sales_daily_self_service_store_month ON bonjur_ods.sales_daily_self_service(store_code, month);
CREATE INDEX IF NOT EXISTS idx_bonjur_sales_daily_self_service_date ON bonjur_ods.sales_daily_self_service(biz_date);
"""

COLMAP = {
    "时间": "biz_date",
    "营业额": "gross_sales_amt",
    "营业收入": "revenue_amt",
    "有效订单数": "order_cnt",
    "退款金额": "refund_amt",
    "营业收入（含服务费）": "revenue_incl_service_fee_amt",
    "平台服务费": "platform_service_fee_amt",

    "微信支付营业额": "wechat_pay_gross_amt",
    "微信支付营业收入": "wechat_pay_revenue_amt",
    "微信支付笔数": "wechat_pay_cnt",
    "微信支付营业额-小程序渠道": "wechat_pay_miniapp_gross_amt",
    "微信支付营业收入-小程序渠道": "wechat_pay_miniapp_revenue_amt",
    "微信支付营业额-企迈数店POS": "wechat_pay_pos_gross_amt",
    "微信支付营业收入-企迈数店POS": "wechat_pay_pos_revenue_amt",

    "支付宝支付营业额": "alipay_pay_gross_amt",
    "支付宝支付营业收入": "alipay_pay_revenue_amt",
    "支付宝支付笔数": "alipay_pay_cnt",
    "支付宝支付营业额-小程序渠道": "alipay_pay_miniapp_gross_amt",
    "支付宝支付营业收入-小程序渠道": "alipay_pay_miniapp_revenue_amt",
    "支付宝支付营业额-企迈数店POS": "alipay_pay_pos_gross_amt",
    "支付宝支付营业收入-企迈数店POS": "alipay_pay_pos_revenue_amt",

    "现金支付营业额": "cash_pay_gross_amt",
    "现金支付营业收入": "cash_pay_revenue_amt",
    "现金支付笔数": "cash_pay_cnt",

    "美团外卖支付营业额": "meituan_delivery_gross_amt",
    "美团外卖支付营业收入": "meituan_delivery_revenue_amt",
    "美团外卖支付支付笔数": "meituan_delivery_cnt",

    "淘宝闪购支付营业额": "taobao_shangou_gross_amt",
    "淘宝闪购支付营业收入": "taobao_shangou_revenue_amt",
    "淘宝闪购支付支付笔数": "taobao_shangou_cnt",

    "京东秒送支付营业额": "jd_miaosong_gross_amt",
    "京东秒送支付营业收入": "jd_miaosong_revenue_amt",
    "京东秒送支付支付笔数": "jd_miaosong_cnt",

    "美团团购券支付笔数": "meituan_coupon_cnt",
    "美团团购券营业额": "meituan_coupon_gross_amt",
    "美团团购券营业收入": "meituan_coupon_revenue_amt",

    "抖音团购券支付笔数": "douyin_coupon_cnt",
    "抖音团购券营业额": "douyin_coupon_gross_amt",
    "抖音团购券营业收入": "douyin_coupon_revenue_amt",

    "支付宝团购券支付笔数": "alipay_coupon_cnt",
    "支付宝团购券营业额": "alipay_coupon_gross_amt",
    "支付宝团购券营业收入": "alipay_coupon_revenue_amt",

    "美团在线点营业额": "meituan_online_gross_amt",
    "美团在线点营业收入": "meituan_online_revenue_amt",
    "美团在线点优惠总额": "meituan_online_discount_amt",

    "抖音在线点支付笔数": "douyin_online_cnt",
    "抖音在线点营业额": "douyin_online_gross_amt",
    "抖音在线点营业收入": "douyin_online_revenue_amt",
}


def parse_path_fallback(file_path: str) -> dict:
    """Parse inputs path with fallback for non-standard paths."""
    p = Path(file_path)
    parts = p.parts
    if "inputs" not in parts:
        return {
            "brand_code": "bonjur",
            "store_code": STORE_CODE_DEFAULT,
            "source_type": SOURCE_TYPE,
            "month": None,
            "month_date": None,
            "file_name": p.name,
            "file_path": str(p),
        }
    return parse_path(file_path, SOURCE_TYPE)


def normalize_date(x) -> Optional[datetime.date]:
    if pd.isna(x) or x is None:
        return None
    s = str(x).strip()
    if not s:
        return None
    # Skip summary row
    if "汇总" in s:
        return None
    # Expect YYYY-MM-DD
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def normalize_month(d) -> Optional[datetime.date]:
    if d is None:
        return None
    return datetime(d.year, d.month, 1).date()


def to_numeric(v):
    if pd.isna(v) or v is None:
        return None
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if s in ("", "--"):
            return None
        try:
            return float(s)
        except Exception:
            return None
    try:
        return float(v)
    except Exception:
        return None


def to_int(v):
    if pd.isna(v) or v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        if s in ("", "--"):
            return None
        try:
            return int(float(s))
        except Exception:
            return None
    try:
        return int(v)
    except Exception:
        return None


# TABLE_DDL defined at top of file


def read_csv(file_path: str) -> pd.DataFrame:
    # csv is comma-separated, utf-8 in our samples
    df = pd.read_csv(file_path)
    return df


def transform(df: pd.DataFrame) -> pd.DataFrame:
    # Keep only known columns
    missing = [c for c in ("时间", "营业额", "营业收入") if c not in df.columns]
    if missing:
        raise ValueError(f"missing required columns: {missing}")

    out = {}

    # date/month
    out["biz_date"] = df["时间"].apply(normalize_date)
    # drop summary/invalid date rows
    mask = out["biz_date"].notna()
    for k in list(out.keys()):
        out[k] = out[k][mask]

    tmp = df.loc[mask].copy()
    out["month"] = out["biz_date"].apply(normalize_month)

    for src, dst in COLMAP.items():
        if src not in tmp.columns:
            continue
        if dst in ("biz_date", "month"):
            continue
        if dst.endswith("_cnt") or dst.endswith("_order") or dst in ("order_cnt",):
            out[dst] = tmp[src].apply(to_int)
        else:
            out[dst] = tmp[src].apply(to_numeric)

    return pd.DataFrame(out)


# IngestFileManager replaces check/create/update_ingest_file functions


INSERT_COLS = [
    "store_code", "store_name", "biz_date", "month",
    "gross_sales_amt", "revenue_amt", "order_cnt", "refund_amt",
    "revenue_incl_service_fee_amt", "platform_service_fee_amt",
    "wechat_pay_gross_amt", "wechat_pay_revenue_amt", "wechat_pay_cnt",
    "wechat_pay_miniapp_gross_amt", "wechat_pay_miniapp_revenue_amt",
    "wechat_pay_pos_gross_amt", "wechat_pay_pos_revenue_amt",
    "alipay_pay_gross_amt", "alipay_pay_revenue_amt", "alipay_pay_cnt",
    "alipay_pay_miniapp_gross_amt", "alipay_pay_miniapp_revenue_amt",
    "alipay_pay_pos_gross_amt", "alipay_pay_pos_revenue_amt",
    "cash_pay_gross_amt", "cash_pay_revenue_amt", "cash_pay_cnt",
    "meituan_delivery_gross_amt", "meituan_delivery_revenue_amt", "meituan_delivery_cnt",
    "taobao_shangou_gross_amt", "taobao_shangou_revenue_amt", "taobao_shangou_cnt",
    "jd_miaosong_gross_amt", "jd_miaosong_revenue_amt", "jd_miaosong_cnt",
    "meituan_coupon_cnt", "meituan_coupon_gross_amt", "meituan_coupon_revenue_amt",
    "douyin_coupon_cnt", "douyin_coupon_gross_amt", "douyin_coupon_revenue_amt",
    "alipay_coupon_cnt", "alipay_coupon_gross_amt", "alipay_coupon_revenue_amt",
    "meituan_online_gross_amt", "meituan_online_revenue_amt", "meituan_online_discount_amt",
    "douyin_online_cnt", "douyin_online_gross_amt", "douyin_online_revenue_amt",
    "source_file_id",
]

CONFLICT_CLAUSE = """
ON CONFLICT (store_code, biz_date) DO UPDATE SET
  store_name = EXCLUDED.store_name,
  month = EXCLUDED.month,
  gross_sales_amt = EXCLUDED.gross_sales_amt,
  revenue_amt = EXCLUDED.revenue_amt,
  order_cnt = EXCLUDED.order_cnt,
  refund_amt = EXCLUDED.refund_amt,
  revenue_incl_service_fee_amt = EXCLUDED.revenue_incl_service_fee_amt,
  platform_service_fee_amt = EXCLUDED.platform_service_fee_amt,
  wechat_pay_gross_amt = EXCLUDED.wechat_pay_gross_amt,
  wechat_pay_revenue_amt = EXCLUDED.wechat_pay_revenue_amt,
  wechat_pay_cnt = EXCLUDED.wechat_pay_cnt,
  wechat_pay_miniapp_gross_amt = EXCLUDED.wechat_pay_miniapp_gross_amt,
  wechat_pay_miniapp_revenue_amt = EXCLUDED.wechat_pay_miniapp_revenue_amt,
  wechat_pay_pos_gross_amt = EXCLUDED.wechat_pay_pos_gross_amt,
  wechat_pay_pos_revenue_amt = EXCLUDED.wechat_pay_pos_revenue_amt,
  alipay_pay_gross_amt = EXCLUDED.alipay_pay_gross_amt,
  alipay_pay_revenue_amt = EXCLUDED.alipay_pay_revenue_amt,
  alipay_pay_cnt = EXCLUDED.alipay_pay_cnt,
  alipay_pay_miniapp_gross_amt = EXCLUDED.alipay_pay_miniapp_gross_amt,
  alipay_pay_miniapp_revenue_amt = EXCLUDED.alipay_pay_miniapp_revenue_amt,
  alipay_pay_pos_gross_amt = EXCLUDED.alipay_pay_pos_gross_amt,
  alipay_pay_pos_revenue_amt = EXCLUDED.alipay_pay_pos_revenue_amt,
  cash_pay_gross_amt = EXCLUDED.cash_pay_gross_amt,
  cash_pay_revenue_amt = EXCLUDED.cash_pay_revenue_amt,
  cash_pay_cnt = EXCLUDED.cash_pay_cnt,
  meituan_delivery_gross_amt = EXCLUDED.meituan_delivery_gross_amt,
  meituan_delivery_revenue_amt = EXCLUDED.meituan_delivery_revenue_amt,
  meituan_delivery_cnt = EXCLUDED.meituan_delivery_cnt,
  taobao_shangou_gross_amt = EXCLUDED.taobao_shangou_gross_amt,
  taobao_shangou_revenue_amt = EXCLUDED.taobao_shangou_revenue_amt,
  taobao_shangou_cnt = EXCLUDED.taobao_shangou_cnt,
  jd_miaosong_gross_amt = EXCLUDED.jd_miaosong_gross_amt,
  jd_miaosong_revenue_amt = EXCLUDED.jd_miaosong_revenue_amt,
  jd_miaosong_cnt = EXCLUDED.jd_miaosong_cnt,
  meituan_coupon_cnt = EXCLUDED.meituan_coupon_cnt,
  meituan_coupon_gross_amt = EXCLUDED.meituan_coupon_gross_amt,
  meituan_coupon_revenue_amt = EXCLUDED.meituan_coupon_revenue_amt,
  douyin_coupon_cnt = EXCLUDED.douyin_coupon_cnt,
  douyin_coupon_gross_amt = EXCLUDED.douyin_coupon_gross_amt,
  douyin_coupon_revenue_amt = EXCLUDED.douyin_coupon_revenue_amt,
  alipay_coupon_cnt = EXCLUDED.alipay_coupon_cnt,
  alipay_coupon_gross_amt = EXCLUDED.alipay_coupon_gross_amt,
  alipay_coupon_revenue_amt = EXCLUDED.alipay_coupon_revenue_amt,
  meituan_online_gross_amt = EXCLUDED.meituan_online_gross_amt,
  meituan_online_revenue_amt = EXCLUDED.meituan_online_revenue_amt,
  meituan_online_discount_amt = EXCLUDED.meituan_online_discount_amt,
  douyin_online_cnt = EXCLUDED.douyin_online_cnt,
  douyin_online_gross_amt = EXCLUDED.douyin_online_gross_amt,
  douyin_online_revenue_amt = EXCLUDED.douyin_online_revenue_amt,
  source_file_id = EXCLUDED.source_file_id
"""


def insert_rows(df: pd.DataFrame, meta: dict, source_file_id: int, conn) -> int:
    store_code = meta.get("store_code") or STORE_CODE_DEFAULT
    store_name = STORE_NAME_DEFAULT

    records = []
    for _, r in df.iterrows():
        row = {
            "store_code": store_code,
            "store_name": store_name,
            "biz_date": r.get("biz_date"),
            "month": r.get("month"),
            "source_file_id": source_file_id,
        }
        for dst in COLMAP.values():
            if dst in ("biz_date",) or dst in row:
                continue
            if dst in df.columns:
                row[dst] = r.get(dst)
        records.append(row)

    if not records:
        return 0

    values = [tuple(r.get(c) for c in INSERT_COLS) for r in records]
    return insert_batch(conn, TARGET_TABLE, INSERT_COLS, values, CONFLICT_CLAUSE)


def main():
    ap = setup_cli_parser("Bonjur 自助下载营业数据（日粒度）导入")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_bonjur_sales_self_service_daily.py [csv_file_or_dir]")

    in_path = Path(args.input)
    files: list[str] = []
    if in_path.is_file():
        files = [str(in_path)]
    else:
        files = [str(p) for p in in_path.rglob("*.csv")]

    if not files:
        raise SystemExit(f"no csv files found under: {in_path}")

    conn = get_connection()
    try:
        for fp in sorted(files):
            meta = parse_path_fallback(fp)
            file_hash = calculate_sha256(fp)
            file_size = os.path.getsize(fp)

            mgr = IngestFileManager(conn)
            existing = mgr.check(file_hash)
            if existing and existing.get("status") == "success":
                print(f"SKIP (already imported): {fp}")
                continue

            if existing:
                source_file_id = int(existing["id"])
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE raw.ingest_file SET status='pending', updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                        (source_file_id,),
                    )
                    conn.commit()
            else:
                source_file_id = mgr.create(
                    meta.get("brand_code") or "bonjur",
                    meta.get("store_code") or STORE_CODE_DEFAULT,
                    meta.get("source_type") or SOURCE_TYPE,
                    meta.get("month_date"),
                    meta.get("file_name"),
                    meta.get("file_path"),
                    file_hash, file_size,
                )
            conn.commit()

            df_raw = read_csv(fp)
            df = transform(df_raw)

            print(f"FILE: {fp}")
            print(f"- rows(raw)={len(df_raw)} rows(valid_date)={len(df)}")

            if args.dry_run:
                continue

            delete_imported_data(conn, source_file_id, TARGET_TABLE)
            ensure_table_exists(conn, "bonjur_ods", "sales_daily_self_service", TABLE_DDL)
            inserted = insert_rows(df, meta, source_file_id, conn)
            mgr.mark_success(source_file_id, inserted)

            print(f"- inserted={inserted} source_file_id={source_file_id}")

        if args.verify and not args.dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT store_code, month, COUNT(*) AS days,
                           SUM(COALESCE(gross_sales_amt,0)) AS gross_sales_amt,
                           SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
                           ROUND(100.0 * SUM(COALESCE(revenue_amt,0)) / NULLIF(SUM(COALESCE(gross_sales_amt,0)),0), 2) AS cash_in_rate_pct
                    FROM bonjur_dm.sales_monthly_report_v1
                    GROUP BY store_code, month
                    ORDER BY month DESC, store_code
                    LIMIT 20;
                    """
                )
                rows = cur.fetchall()
                print("VERIFY bonjur_dm.sales_monthly_report_v1 (top):")
                for r in rows:
                    print(r)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
