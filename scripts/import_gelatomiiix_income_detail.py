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
    load_valid_stores,
    setup_cli_parser,
)

STORE_CODE = os.getenv("INCOME_STORE_CODE", "sh_xtd")
STORE_NAME = ""
BRAND_CODE = os.getenv("INCOME_BRAND_CODE", "gelatomiiix")
# 与通用 /api/upload 及 upload-qimai 路由约定一致（issue #41），raw.ingest_file.source_type 统一 'income'
SOURCE_TYPE = "income"

def get_target_table(brand: str) -> str:
    if brand in ('bonjur',):
        return "bonjur_ods.income_detail"
    if brand in ('gelatomiiix',):
        return "gelatomiiix_ods.income_detail"
    return f"brand_{brand}_ods.income_detail"

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

MEMBER_METHOD_INDICATORS = {
    "自定义结账方式",
    "会员快速支付",
}


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


def parse_datetime(s: str) -> Optional[datetime]:
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
    if not s or s.strip() in ("--", ""):
        return None
    s = s.strip()
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except ValueError:
        return None


def transform_row(r: dict, source_file: str, store_code_override: str = "",
                   store_name_override: str = "",
                   valid_stores: Optional[set[str]] = None,
                   stats: Optional[dict] = None) -> Optional[dict]:
    order_no_raw = r.get("订单号", "").strip()
    order_no = strip_backtick(order_no_raw)
    if not order_no:
        return None

    biz_date = parse_date(r.get("营业日期"))
    if biz_date is None:
        return None

    pay_time = parse_datetime(r.get("支付时间"))
    order_time = parse_datetime(r.get("下单时间"))

    raw_split = r.get("结账方式拆分", "").strip()
    raw_name = r.get("结账方式名称", "").strip()

    is_member = raw_split in MEMBER_METHOD_INDICATORS or raw_name in MEMBER_METHOD_INDICATORS

    payment_methods = []
    if not is_member:
        for item in raw_split.split(","):
            item = item.strip()
            if item in THIRD_PARTY_METHODS:
                payment_methods.append(item)

    third_party_txn_no_raw = r.get("三方支付流水号", "").strip()
    third_party_txn_no = strip_backtick(third_party_txn_no_raw) if third_party_txn_no_raw not in ("", "--") else None

    third_party_order_no_raw = r.get("三方订单号", "").strip()
    third_party_order_no = strip_backtick(third_party_order_no_raw) if third_party_order_no_raw not in ("", "--") else None

    merchant_order_no_raw = r.get("商户订单号", "").strip()
    merchant_order_no = merchant_order_no_raw if merchant_order_no_raw not in ("", "--") else None

    coupon_id_raw = r.get("三方券id", "").strip()
    coupon_id = coupon_id_raw if coupon_id_raw not in ("", "--") else None

    member_id_raw = r.get("会员id", "").strip()
    member_id = strip_backtick(member_id_raw) if member_id_raw not in ("", "--") else None

    revenue_amt = to_numeric(r.get("营业收入")) or 0.0
    net_amt = to_numeric(r.get("营业净收")) or 0.0
    gross_amt = to_numeric(r.get("营业额")) or 0.0
    discount_amt = to_numeric(r.get("优惠总额")) or 0.0
    overflow_amt = to_numeric(r.get("溢收金额")) or 0.0
    coupon_fee = to_numeric(r.get("团购券手续费")) or 0.0

    biz_source = r.get("订单来源", "").strip() or None
    order_type = r.get("订单类型", "").strip() or None
    is_refund = r.get("是否反结", "").strip() == "是"

    member_phone = r.get("用户手机号", "").strip()
    member_phone = member_phone if member_phone and member_phone != "--" else None

    csv_store_code = r.get("门店编码", "").strip().strip("`")
    csv_store_name = r.get("门店名称", "").strip()

    if store_code_override:
        resolved_store_code = store_code_override
    elif csv_store_code:
        if valid_stores is not None and csv_store_code not in valid_stores:
            if stats is not None:
                stats["skipped_cross_brand"] = stats.get("skipped_cross_brand", 0) + 1
                stats.setdefault("cross_brand_samples", []).append({
                    "order_no": order_no,
                    "csv_store_code": csv_store_code,
                })
            return None
        resolved_store_code = csv_store_code
    else:
        if valid_stores is not None and STORE_CODE not in valid_stores:
            if stats is not None:
                stats["skipped_cross_brand"] = stats.get("skipped_cross_brand", 0) + 1
            return None
        resolved_store_code = STORE_CODE

    return {
        "store_code": resolved_store_code,
        "store_name": store_name_override or csv_store_name,
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


def extract_month_from_filename(fname: str) -> Optional[str]:
    patterns = [
        r"(\d{4})-(\d{2})-(\d{2})",
        r"(\d{4})年(\d{1,2})月(\d{1,2})日",
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


def process_file(fp: str, conn, dry_run: bool, store_code: str = "", store_name: str = "",
                  valid_stores: Optional[set[str]] = None) -> dict:
    file_hash = calculate_sha256(fp)
    file_size = os.path.getsize(fp)
    source_file = str(Path(fp).resolve())
    target_table = get_target_table(BRAND_CODE)

    mgr = IngestFileManager(conn)
    existing = mgr.check(file_hash, BRAND_CODE)
    if existing and existing["status"] == "success":
        print(f"  SKIP (already imported): {Path(fp).name}")
        return {"skipped": True}

    month = extract_month_from_filename(Path(fp).name)
    if existing:
        source_file_id = existing["id"]
    else:
        source_file_id = mgr.create(
            BRAND_CODE, STORE_CODE, SOURCE_TYPE,
            month, Path(fp).name, source_file, file_hash, file_size,
        )
    conn.commit()

    stats: dict = {"skipped_cross_brand": 0, "cross_brand_samples": []}
    rows = []
    with open(fp, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            row = transform_row(r, source_file, store_code, store_name, valid_stores, stats)
            if row:
                rows.append(row)

    if stats["skipped_cross_brand"]:
        samples = stats["cross_brand_samples"][:3]
        sample_str = ", ".join(
            f"{s['order_no']}@{s['csv_store_code']}" for s in samples
        )
        print(
            f"  ⚠️  skipped_cross_brand: {stats['skipped_cross_brand']} 行 "
            f"(CSV 里的「门店编码」不属于 brand={BRAND_CODE} 合法集合); 样本: {sample_str}"
        )

    if dry_run:
        print(f"  DRY-RUN: {Path(fp).name} -> {len(rows)} records")
        mgr.mark_pending(source_file_id, len(rows))
        return {"name": Path(fp).name, "records": len(rows), **stats}

    COLUMNS = [
        "store_code", "store_name", "biz_date", "order_no", "order_no_clean",
        "pay_time", "order_time",
        "revenue_amt", "net_amt", "gross_amt", "discount_amt", "overflow_amt", "coupon_fee",
        "payment_methods",
        "third_party_txn_no", "third_party_order_no", "merchant_order_no", "coupon_id",
        "biz_source", "order_type", "is_refund", "is_member_payment",
        "member_id", "member_phone", "source_file", "source_file_id",
    ]

    CONFLICT_CLAUSE = """
    ON CONFLICT (store_code, order_no_clean) DO UPDATE SET
      store_name = EXCLUDED.store_name,
      biz_date = EXCLUDED.biz_date,
      pay_time = EXCLUDED.pay_time,
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
    """

    seen: set[str] = set()
    deduped: list[dict] = []
    for r in rows:
        key = r["order_no_clean"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    values = [
        (
            r["store_code"], r["store_name"], r["biz_date"], r["order_no"], r["order_no_clean"],
            r["pay_time"], r["order_time"],
            r["revenue_amt"], r["net_amt"], r["gross_amt"], r["discount_amt"], r["overflow_amt"], r["coupon_fee"],
            r["payment_methods"],
            r["third_party_txn_no"], r["third_party_order_no"], r["merchant_order_no"], r["coupon_id"],
            r["biz_source"], r["order_type"], r["is_refund"], r["is_member_payment"],
            r["member_id"], r["member_phone"], r["source_file"], source_file_id,
        )
        for r in deduped
    ]

    inserted = insert_batch(conn, target_table, COLUMNS, values, CONFLICT_CLAUSE)
    mgr.mark_success(source_file_id, inserted)
    print(f"  INSERTED: {Path(fp).name} -> {inserted} records (from {len(rows)} parsed, {len(rows) - inserted} duplicates)")
    return {"name": Path(fp).name, "total": len(rows), "inserted": inserted, **stats}


def main():
    ap = setup_cli_parser("收入明细表 CSV 导入（多品牌支持）")
    args = ap.parse_args()

    if not args.input:
        raise SystemExit("Usage: python import_gelatomiiix_income_detail.py [csv_file_or_dir]")

    brand_code = args.brand or BRAND_CODE
    explicit_store_code = bool(args.store_code)
    store_code_arg = args.store_code or ""

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
        valid_stores = load_valid_stores(brand_code, conn)
        print(f"Brand: {brand_code}, valid stores: {sorted(valid_stores)}")

        store_name = ""
        if explicit_store_code:
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT store_name FROM ops.stores WHERE store_code = %s AND enabled = true LIMIT 1",
                    (store_code_arg,),
                )
                row = cur.fetchone()
                store_name = row[0] if row else store_code_arg
                cur.close()
            except Exception:
                store_name = store_code_arg
        else:
            store_name = ""

        if explicit_store_code and store_code_arg not in valid_stores:
            raise SystemExit(
                f"FATAL: --store-code {store_code_arg!r} 不属于 brand={brand_code!r} 的合法门店 "
                f"(合法集合: {sorted(valid_stores)})"
            )

        if not valid_stores:
            raise SystemExit(f"FATAL: ops.stores 中没有 brand={brand_code!r} 的 enabled 门店")

        target_table = get_target_table(brand_code)
        if explicit_store_code:
            print(f"Target table: {target_table}, Store override: {store_code_arg}")
        else:
            print(f"Target table: {target_table}, Store: 读 CSV 内的「门店编码」列")

        for fp in files:
            process_file(
                fp, conn, args.dry_run,
                store_code_arg if explicit_store_code else "",
                store_name, valid_stores,
            )
    finally:
        conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
