#!/usr/bin/env python3
"""
gelatomiiix | 收入明细表导入脚本

导入企迈收入明细表 CSV 到 gelatomiiix_ods.income_detail。

支持批量导入 Report/ 目录下的多个 CSV 文件。
按 order_no_clean（去反引号）去重，保留首次出现的记录。

Usage:
    python scripts/import_gelatomiiix_income_detail.py [csv_file_or_dir]
    python scripts/import_gelatomiiix_income_detail.py Report/
    python scripts/import_gelatomiiix_income_detail.py --dry-run
"""

import argparse
import csv
import hashlib
import os
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

STORE_CODE = "sh_xtd"
STORE_NAME = "上海新天地广场"
TARGET_TABLE = "gelatomiiix_ods.income_detail"

# 有效第三方支付渠道（存入 payment_methods，计入银行入账率）
THIRD_PARTY_METHODS = {
    "微信支付",
    "支付宝支付",
    "美团团购券",
    "云闪付",
    "抖音团购券",
    "淘宝闪购支付",
    "京东秒送支付",
    "京东支付",
    "美团外卖支付",
    "美团在线点单",
    "饿了么",
    "现金支付",
}

# 会员快速支付标识（不存入 payment_methods，不计入银行入账率）
MEMBER_METHOD_INDICATORS = {
    "自定义结账方式",
    "会员快速支付",
}


def calculate_sha256(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(block)
    return sha256_hash.hexdigest()


def strip_backtick(s: str) -> str:
    """去掉反引号前缀，如 `D001... -> D001..."""
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


def parse_datetime(s: str) -> Optional[datetime]:
    """解析 YYYY-MM-DD HH:MM:SS 或 YYYY-MM-DD HH:MM 格式"""
    if not s or s.strip() in ("--", ""):
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def parse_date(s: str) -> Optional[datetime]:
    """解析 YYYY-MM-DD 格式"""
    if not s or s.strip() in ("--", ""):
        return None
    s = s.strip()
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except ValueError:
        return None


def transform_row(r: dict, source_file: str) -> Optional[dict]:
    """将 CSV 行转换为数据库记录"""
    order_no_raw = r.get("订单号", "").strip()
    order_no = strip_backtick(order_no_raw)
    if not order_no:
        return None

    biz_date = parse_date(r.get("营业日期"))
    if biz_date is None:
        return None

    pay_time = parse_datetime(r.get("支付时间"))
    order_time = parse_datetime(r.get("下单时间"))

    # 处理支付方式：区分会员支付和第三方支付
    raw_split = r.get("结账方式拆分", "").strip()
    raw_name = r.get("结账方式名称", "").strip()

    is_member = raw_split in MEMBER_METHOD_INDICATORS or raw_name in MEMBER_METHOD_INDICATORS

    payment_methods = []
    if not is_member:
        for item in raw_split.split(","):
            item = item.strip()
            if item in THIRD_PARTY_METHODS:
                payment_methods.append(item)

    # 清洗第三方流水号
    third_party_txn_no_raw = r.get("三方支付流水号", "").strip()
    third_party_txn_no = strip_backtick(third_party_txn_no_raw) if third_party_txn_no_raw not in ("", "--") else None

    third_party_order_no_raw = r.get("三方订单号", "").strip()
    third_party_order_no = strip_backtick(third_party_order_no_raw) if third_party_order_no_raw not in ("", "--") else None

    merchant_order_no_raw = r.get("商户订单号", "").strip()
    merchant_order_no = merchant_order_no_raw if merchant_order_no_raw not in ("", "--") else None

    coupon_id_raw = r.get("三方券id", "").strip()
    coupon_id = coupon_id_raw if coupon_id_raw not in ("", "--") else None

    # 会员ID清洗
    member_id_raw = r.get("会员id", "").strip()
    member_id = strip_backtick(member_id_raw) if member_id_raw not in ("", "--") else None

    # 金额
    revenue_amt = to_numeric(r.get("营业收入")) or 0.0
    net_amt = to_numeric(r.get("营业净收")) or 0.0
    gross_amt = to_numeric(r.get("营业额")) or 0.0
    discount_amt = to_numeric(r.get("优惠总额")) or 0.0
    overflow_amt = to_numeric(r.get("溢收金额")) or 0.0
    coupon_fee = to_numeric(r.get("团购券手续费")) or 0.0

    # 订单属性
    biz_source = r.get("订单来源", "").strip() or None
    order_type = r.get("订单类型", "").strip() or None
    is_refund = r.get("是否反结", "").strip() == "是"

    # 手机号
    member_phone = r.get("用户手机号", "").strip()
    member_phone = member_phone if member_phone and member_phone != "--" else None

    return {
        "store_code": STORE_CODE,
        "store_name": STORE_NAME,
        "biz_date": biz_date.date() if biz_date else None,
        "order_no": order_no_raw,
        "order_no_clean": order_no,
        "pay_time": pay_time,
        "order_time": order_time,
        "revenue_amt": revenue_amt,
        "net_amt": net_amt,
        "gross_amt": gross_amt,
        "discount_amt": discount_amt,
        "overflow_amt": overflow_amt,
        "coupon_fee": coupon_fee,
        "payment_methods": payment_methods if payment_methods else None,
        "third_party_txn_no": third_party_txn_no,
        "third_party_order_no": third_party_order_no,
        "merchant_order_no": merchant_order_no,
        "coupon_id": coupon_id,
        "biz_source": biz_source,
        "order_type": order_type,
        "is_refund": is_refund,
        "is_member_payment": is_member,
        "member_id": member_id,
        "member_phone": member_phone,
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


def extract_month_from_filename(fname: str) -> Optional[str]:
    """从文件名提取最后一个日期的年月，作为 month 字段
    例: '企迈 收入明细表 2025-12-01 至 2026-01-31.csv' -> '2026-01-01'
        '企迈 收入明细表 2026年2月到3月.csv' -> '2026-03-01'
    """
    import re
    # 匹配各种格式的日期：YYYY-MM-DD, YYYY年MM月, YYYY年MM月DD日
    patterns = [
        r"(\d{4})-(\d{2})-(\d{2})",       # YYYY-MM-DD
        r"(\d{4})年(\d{1,2})月(\d{1,2})日", # YYYY年MM月DD日
        r"(\d{4})年(\d{1,2})月",            # YYYY年MM月
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
    # 取最晚的年月
    year, month = max(candidates)
    return f"{year:04d}-{month:02d}-01"


def create_ingest_file(source_file: str, file_hash: str, file_size: int, conn) -> int:
    month = extract_month_from_filename(source_file)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO raw.ingest_file
              (brand_code, store_code, source_type, month, file_name, file_path, file_hash, file_size, status)
            VALUES ('gelatomiiix', %s, 'income_detail', %s, %s, %s, %s, %s, 'pending')
            RETURNING id
            """,
            (STORE_CODE, month, Path(source_file).name, source_file, file_hash, file_size),
        )
        return cur.fetchone()[0]


def update_ingest_file(source_file_id: int, row_count: int, conn, status: str = "success"):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE raw.ingest_file SET status=%s, row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
            (status, row_count, source_file_id),
        )
        conn.commit()


def insert_rows(records: list[dict], source_file_id: int, conn) -> int:
    """去重后插入：按 order_no_clean 取首次出现"""
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in records:
        key = r["order_no_clean"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    values = [
        (
            r["store_code"],
            r["store_name"],
            r["biz_date"],
            r["order_no"],
            r["order_no_clean"],
            r["pay_time"],
            r["order_time"],
            r["revenue_amt"],
            r["net_amt"],
            r["gross_amt"],
            r["discount_amt"],
            r["overflow_amt"],
            r["coupon_fee"],
            r["payment_methods"],
            r["third_party_txn_no"],
            r["third_party_order_no"],
            r["merchant_order_no"],
            r["coupon_id"],
            r["biz_source"],
            r["order_type"],
            r["is_refund"],
            r["is_member_payment"],
            r["member_id"],
            r["member_phone"],
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
              (store_code, store_name, biz_date, order_no, order_no_clean,
               pay_time, order_time,
               revenue_amt, net_amt, gross_amt, discount_amt, overflow_amt, coupon_fee,
               payment_methods,
               third_party_txn_no, third_party_order_no, merchant_order_no, coupon_id,
               biz_source, order_type, is_refund, is_member_payment,
               member_id, member_phone, source_file, source_file_id)
            VALUES %s
            ON CONFLICT (store_code, order_no_clean) DO UPDATE SET
              store_name = EXCLUDED.store_name,
              biz_date = EXCLUDED.biz_date,
              pay_time = EXCLUDED.pay_time,
              order_time = EXCLUDED.order_time,
              revenue_amt = EXCLUDED.revenue_amt,
              net_amt = EXCLUDED.net_amt,
              gross_amt = EXCLUDED.gross_amt,
              discount_amt = EXCLUDED.discount_amt,
              overflow_amt = EXCLUDED.overflow_amt,
              coupon_fee = EXCLUDED.coupon_fee,
              payment_methods = EXCLUDED.payment_methods,
              third_party_txn_no = EXCLUDED.third_party_txn_no,
              third_party_order_no = EXCLUDED.third_party_order_no,
              merchant_order_no = EXCLUDED.merchant_order_no,
              coupon_id = EXCLUDED.coupon_id,
              biz_source = EXCLUDED.biz_source,
              order_type = EXCLUDED.order_type,
              is_refund = EXCLUDED.is_refund,
              is_member_payment = EXCLUDED.is_member_payment,
              member_id = EXCLUDED.member_id,
              member_phone = EXCLUDED.member_phone,
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
    source_file = str(Path(fp).resolve())

    existing = check_ingest_file(file_hash, conn)
    if existing and existing["status"] == "success":
        print(f"  SKIP (already imported): {Path(fp).name}")
        return {"skipped": True}

    source_file_id = existing["id"] if existing else create_ingest_file(source_file, file_hash, file_size, conn)
    conn.commit()

    rows = []
    with open(fp, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            row = transform_row(r, source_file)
            if row:
                rows.append(row)

    if dry_run:
        print(f"  DRY-RUN: {Path(fp).name} -> {len(rows)} records")
        update_ingest_file(source_file_id, len(rows), conn, "pending")
        return {"name": Path(fp).name, "records": len(rows)}

    inserted = insert_rows(rows, source_file_id, conn)
    update_ingest_file(source_file_id, inserted, conn)
    print(f"  INSERTED: {Path(fp).name} -> {inserted} records (from {len(rows)} parsed, {len(rows) - inserted} duplicates)")
    return {"name": Path(fp).name, "total": len(rows), "inserted": inserted}


def main():
    ap = argparse.ArgumentParser(description="gelatomiiix 收入明细表 CSV 导入")
    ap.add_argument("input", help="CSV file or directory containing CSV files")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report without inserting")
    args = ap.parse_args()

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