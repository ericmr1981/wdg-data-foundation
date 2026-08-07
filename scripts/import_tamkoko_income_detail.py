#!/usr/bin/env python3
"""
Tamkoko | 企迈收入明细表导入脚本

导入企迈收入明细表 CSV 到 brand_tamkoko_ods.income_detail。
schema 与字段映射沿用 gelatomiiix 的 28 列新 schema（用户决策，2026-08-07）。

Usage:
    python scripts/import_tamkoko_income_detail.py [csv_file_or_dir]
    python scripts/import_tamkoko_income_detail.py Report/
    python scripts/import_tamkoko_income_detail.py --dry-run
"""

import csv
import os
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

# UI 上传 source='income'，文件落盘到 inputs/{brand}/{store}/income/{YYYY-MM}/，
# raw.ingest_file.source_type='income'。早期版本误用 "income_detail" 导致
# parse_path ValueError、spawn 静默退出（issue #41），必须与 UI 约定一致。
SOURCE_TYPE = "income"

# 第三方支付方式（写入 payment_methods[]）；会员快速支付等自定义方式单独标记
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


def get_target_table(brand: str) -> str:
    if brand == "bonjur":
        return "bonjur_ods.income_detail"
    if brand in ("gelatomiiix", "yufeng"):
        return "gelatomiiix_ods.income_detail"
    if brand == "tamkoko":
        return "brand_tamkoko_ods.income_detail"
    raise ValueError(f"Unknown brand: {brand}")


# 28 列新 schema，与 VPS 实际表 / gelatomiiix_ods.income_detail 一致（issue #41 实测）。
# 注意：本脚本不执行 TABLE_DDL（新环境建表请执行 sql/20_tamkoko_ods_income_detail.sql；
# 既有 16 列表请执行 sql/60_align_tamkoko_income_detail_28col.sql 幂等对齐）。
# CREATE TABLE IF NOT EXISTS 不会修复已存在表的结构漂移。
TABLE_DDL = """
CREATE SCHEMA IF NOT EXISTS brand_tamkoko_ods;
CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.income_detail (
    id                  BIGSERIAL PRIMARY KEY,
    store_code          TEXT NOT NULL,
    store_name          TEXT NOT NULL DEFAULT '',
    biz_date            DATE NOT NULL,
    order_no            TEXT NOT NULL,
    order_no_clean      TEXT NOT NULL,
    pay_time            TIMESTAMPTZ,
    order_time          TIMESTAMPTZ,
    revenue_amt         NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_amt             NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_amt           NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amt        NUMERIC(14,2) NOT NULL DEFAULT 0,
    overflow_amt        NUMERIC(14,2) NOT NULL DEFAULT 0,
    coupon_fee          NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_methods     TEXT[],
    third_party_txn_no  TEXT,
    third_party_order_no TEXT,
    merchant_order_no   TEXT,
    coupon_id           TEXT,
    biz_source          TEXT,
    order_type          TEXT,
    is_refund           BOOLEAN NOT NULL DEFAULT FALSE,
    is_member_payment   BOOLEAN NOT NULL DEFAULT FALSE,
    member_id           TEXT,
    member_phone        TEXT,
    source_file         TEXT,
    source_file_id      BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tamkoko_income_detail UNIQUE (store_code, order_no_clean)
);
"""

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
"""


def strip_backtick(s: Optional[str]) -> Optional[str]:
    """去掉反引号前缀；None 安全（issue #41: CSV 空字段曾崩 AttributeError）"""
    if s is None:
        return None
    return s.strip().strip("`")


def to_numeric(s) -> float:
    if s is None or str(s).strip() in ("", "--"):
        return 0.0
    try:
        return float(str(s).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def parse_datetime(s) -> Optional[datetime]:
    if not s or str(s).strip() in ("", "--"):
        return None
    s = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def parse_date(s) -> Optional[str]:
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def transform_row(r: dict, store_code: str, source_file: str) -> Optional[dict]:
    """CSV 行 -> 28 列 dict。order_no 缺失或营业日期非法时返回 None。"""
    order_no_raw = (r.get("订单号") or "").strip()
    order_no = strip_backtick(order_no_raw)
    if not order_no:
        return None

    biz_date = parse_date(r.get("营业日期"))
    if biz_date is None:
        return None

    pay_time = parse_datetime(r.get("支付时间"))
    order_time = parse_datetime(r.get("下单时间"))

    raw_split = (r.get("结账方式拆分") or "").strip()
    raw_name = (r.get("结账方式名称") or "").strip()
    is_member = raw_split in MEMBER_METHOD_INDICATORS or raw_name in MEMBER_METHOD_INDICATORS
    payment_methods = []
    if not is_member:
        for item in raw_split.split(","):
            item = item.strip()
            if item in THIRD_PARTY_METHODS:
                payment_methods.append(item)

    def _clean(v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        return strip_backtick(v) if v not in ("", "--") else None

    return {
        "store_code": store_code,
        "store_name": (r.get("门店名称") or "").strip(),
        "biz_date": biz_date,
        "order_no": order_no_raw,
        "order_no_clean": order_no,
        "pay_time": pay_time,
        "order_time": order_time,
        "revenue_amt": to_numeric(r.get("营业收入")),
        "net_amt": to_numeric(r.get("营业净收")),
        "gross_amt": to_numeric(r.get("营业额")),
        "discount_amt": to_numeric(r.get("优惠总额")),
        "overflow_amt": to_numeric(r.get("溢收金额")),
        "coupon_fee": to_numeric(r.get("团购券手续费")),
        "payment_methods": payment_methods if payment_methods else None,
        "third_party_txn_no": _clean(r.get("三方支付流水号")),
        "third_party_order_no": _clean(r.get("三方订单号")),
        "merchant_order_no": _clean(r.get("商户订单号")),
        "coupon_id": _clean(r.get("三方券id")),
        "biz_source": (r.get("订单来源") or "").strip() or None,
        "order_type": (r.get("订单类型") or "").strip() or None,
        "is_refund": (r.get("是否反结") or "").strip() == "是",
        "is_member_payment": is_member,
        "member_id": _clean(r.get("会员id")),
        "member_phone": _clean(r.get("用户手机号")),
        "source_file": source_file,
    }


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
            source_file_id = None
            try:
                print(f"\n=== {csv_path.name} ===")
                meta = parse_path(str(csv_path), SOURCE_TYPE)
                print(f"  brand={meta['brand_code']}, store={meta['store_code']}, month={meta['month']}")

                rows = []
                with open(csv_path, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        row = transform_row(r, meta["store_code"], csv_path.name)
                        if row:
                            rows.append(row)

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

                # 按 order_no_clean 去重（与 ON CONFLICT 唯一约束一致），保留首次出现
                seen: set[str] = set()
                deduped = []
                for row in rows:
                    key = row["order_no_clean"]
                    if key not in seen:
                        seen.add(key)
                        deduped.append(row)

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

                inserted = insert_batch(conn, table, COLUMNS, values, CONFLICT_CLAUSE)
                mgr.mark_success(source_file_id, inserted)
                print(f"  ✅ 导入成功, source_file_id={source_file_id}, rows={inserted}")
            except Exception as e:
                error_msg = str(e)
                print(f"  ❌ 导入失败: {error_msg}")
                # 失败时写 error_message，不让 spawn 静默退出（issue #41 bug 5）
                try:
                    # INSERT 失败后 psycopg2 事务处于 aborted 状态，必须先回滚
                    conn.rollback()
                except Exception:
                    pass
                if source_file_id:
                    try:
                        mgr.mark_failed(source_file_id, error_message=error_msg)
                    except Exception as mark_err:
                        print(f"  ⚠️ 写入失败状态失败: {mark_err}")
                else:
                    # source_file_id 未知（check/create 阶段异常）时无法标记，
                    # 显式退出码 1，让路由层返回 500（避免 read-back 无记录误报成功）
                    print(f"  ⚠️ 无 source_file_id，以退出码 1 结束: {error_msg}")
                    sys.exit(1)
                continue
    finally:
        conn.close()


if __name__ == "__main__":
    main()
