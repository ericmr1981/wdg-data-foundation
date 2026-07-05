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

import argparse
import csv
import hashlib
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from _store_guard import (
    CrossBrandStoreError,
    load_valid_stores,
    safe_resolve_store,
)

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "dataplatform"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.environ["DB_PASSWORD"],
}

STORE_CODE = os.getenv("INCOME_STORE_CODE", "hz_fuyang")
STORE_NAME = os.getenv("INCOME_STORE_NAME", "")
BRAND_CODE = os.getenv("INCOME_BRAND_CODE", "tamkoko")

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


def calculate_sha256(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(4096), b""):
            h.update(block)
    return h.hexdigest()


def strip_backtick(s: str) -> str:
    return s.strip().strip("`")


def parse_path(file_path: str) -> dict:
    """从路径解析元数据: inputs/{brand}/{store}/income_detail/{YYYY-MM}/{filename}"""
    path = Path(file_path)
    parts = path.parts
    if "inputs" not in parts:
        raise ValueError(f"路径必须包含 'inputs' 目录: {file_path}")
    idx = parts.index("inputs")
    if len(parts) < idx + 5:
        raise ValueError(
            f"路径格式错误: inputs/{{brand}}/{{store}}/income_detail/{{YYYY-MM}}/{{filename}}\n"
            f"实际: {file_path}"
        )
    brand_code = parts[idx + 1]
    store_code = parts[idx + 2]
    source_type = parts[idx + 3]
    month_str = parts[idx + 4]
    if source_type != "income_detail":
        raise ValueError(f"source_type 必须是 'income_detail', 实际: {source_type}")
    if not re.match(r"^\d{4}-\d{2}$", month_str):
        raise ValueError(f"月份格式错误 (需 YYYY-MM): {month_str}")
    return {
        "brand_code": brand_code,
        "store_code": store_code,
        "source_type": source_type,
        "month": month_str,
        "file_name": path.name,
        "file_path": file_path,
    }


def extract_month_from_filename(fname: str) -> Optional[str]:
    """从文件名提取最晚年月,支持 '企迈 收入明细表 2026-02-01 至 2026-03-31.csv'"""
    if not fname:
        return None
    candidates = []
    # 1) YYYY-MM-DD
    for m in re.finditer(r"(\d{4})-(\d{2})-\d{2}", fname):
        y, mo = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            candidates.append(y * 100 + mo)
    # 2) YYYY年M月
    for m in re.finditer(r"(\d{4})年(\d{1,2})月", fname):
        y, mo = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            candidates.append(y * 100 + mo)
    if not candidates:
        return None
    latest = max(candidates)
    return f"{latest // 100}-{str(latest % 100).zfill(2)}"


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
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="CSV 文件或目录路径")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--brand", default=BRAND_CODE)
    args = parser.parse_args()

    target = Path(args.path)
    if target.is_file():
        files = [target]
    elif target.is_dir():
        files = list(target.glob("*.csv"))
    else:
        print(f"路径不存在: {args.path}", file=sys.stderr)
        sys.exit(1)

    if not files:
        print(f"未找到 CSV 文件: {args.path}", file=sys.stderr)
        sys.exit(1)

    table = get_target_table(args.brand)
    print(f"目标表: {table}, 文件数: {len(files)}")

    conn = psycopg2.connect(**DB_CONFIG)
    try:
        for csv_path in files:
            print(f"\n=== {csv_path.name} ===")
            meta = parse_path(str(csv_path))
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
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO raw.ingest_file (brand_code, store_code, source_type, month, file_name, file_path, file_hash, file_size, status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
                       ON CONFLICT (file_hash) DO UPDATE SET status = 'pending', updated_at = NOW()
                       RETURNING id""",
                    (meta["brand_code"], meta["store_code"], "income_detail",
                     meta["month"], meta["file_name"], str(csv_path), file_hash, csv_path.stat().st_size),
                )
                source_file_id = cur.fetchone()[0]
                conn.commit()

                execute_values(
                    cur,
                    f"""INSERT INTO {table} (
                        store_code, brand_name, city, store_name, biz_date, order_no, channel,
                        gross_amt, net_amt, revenue_amt, payment_methods,
                        third_party_txn_no, order_source, order_type, source_file
                    ) VALUES %s
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
                    [(*r, source_file_id) for r in rows],
                )
                conn.commit()

                cur.execute(
                    "UPDATE raw.ingest_file SET status='success', row_count=%s, finished_at=NOW(), updated_at=NOW() WHERE id=%s",
                    (len(rows), source_file_id),
                )
                conn.commit()
            print(f"  ✅ 导入成功,source_file_id={source_file_id},rows={len(rows)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
