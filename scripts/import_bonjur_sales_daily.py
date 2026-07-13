#!/usr/bin/env python3
"""
Bonjur 营业数据导入脚本
用途：将营业数据 CSV/Excel 文件导入到 bonjur_ods.sales_monthly 表

输入：
  - 文件路径：CSV/Excel 文件
  - 目录路径：按 inputs/ 约定递归找到 bonjur/*/sales/YYYY-MM/*

功能：
  - 自动解析路径获取 brand_code/store_code/source_type/month
  - 计算 SHA-256 file_hash
  - 幂等导入：按 source_file_id 删除当次导入数据后重灌
  - 解析营业数据（过滤汇总行、门店映射、month 归一）
  - 写入 bonjur_ods.sales_monthly
  - 更新 raw.ingest_file 状态

运行示例：
  python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/营业日报_温州瓯海万象城_2026-02.csv
  python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/ --dry-run
  python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/ --verify
"""

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
    ensure_table_exists,
    get_connection,
    IngestFileManager,
    insert_batch,
    parse_path,
    setup_cli_parser,
)
from ops_logger import create_ops_logger

# 门店名 → store_code 映射（来自 Bonjur_T1_字段映射与清洗规则.md）
STORE_NAME_MAPPING = {
    "温州瓯海万象城店": "wz_oh_wxc",
    "温州瑞安吾悦广场店": "wz_ra_wy",
    "杭州in77": "hz_in77",
}

COLUMN_MAPPING = {
    "门店": "store_name",
    "时间": "month",
    "营业额": "gross_sales_amt",
    "优惠总额": "discount_amt",
    "营业收入": "revenue_amt",
    "有效订单数": "order_cnt",
    "退款金额": "refund_amt",
}

TARGET_TABLE = "bonjur_ods.sales_monthly"
SOURCE_TYPE = "sales"

TABLE_DDL = """
CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE TABLE IF NOT EXISTS bonjur_ods.sales_monthly (
    id               bigserial primary key,
    store_code       text not null,
    store_name       text,
    month            date not null,
    gross_sales_amt  numeric(14,2),
    discount_amt     numeric(14,2),
    revenue_amt      numeric(14,2),
    order_cnt        int,
    refund_amt       numeric(14,2),
    source_file_id   bigint,
    created_at       timestamptz not null default now(),
    constraint uq_sales_monthly unique (store_code, month)
);
CREATE INDEX IF NOT EXISTS idx_sales_monthly_month ON bonjur_ods.sales_monthly(month);
CREATE INDEX IF NOT EXISTS idx_sales_monthly_store ON bonjur_ods.sales_monthly(store_code);
"""

COLUMNS = [
    "store_code", "store_name", "month",
    "gross_sales_amt", "discount_amt", "revenue_amt", "order_cnt", "refund_amt",
    "source_file_id",
]


def find_sales_files(input_path: str) -> list[str]:
    path = Path(input_path)
    files = []
    if path.is_file():
        if path.suffix.lower() in (".csv", ".xlsx", ".xls"):
            files.append(str(path))
    else:
        for subpath in path.rglob("*"):
            if subpath.is_file() and subpath.suffix.lower() in (".csv", ".xlsx", ".xls"):
                try:
                    parse_path(str(subpath), SOURCE_TYPE)
                    files.append(str(subpath))
                except ValueError:
                    continue
    return sorted(files)


def parse_amount(value) -> Optional[float]:
    if pd.isna(value) or value == "" or value is None:
        return None
    if isinstance(value, str):
        value = value.replace(",", "").strip()
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def parse_int(value) -> Optional[int]:
    if pd.isna(value) or value == "" or value is None:
        return None
    if isinstance(value, str):
        value = value.replace(",", "").strip()
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def normalize_month(value) -> Optional[str]:
    if pd.isna(value) or value == "" or value is None:
        return None
    value_str = str(value).strip()
    if re.match(r"^\d{4}-\d{2}$", value_str):
        return f"{value_str}-01"
    formats = ["%Y-%m", "%Y/%m", "%Y%m"]
    for fmt in formats:
        try:
            dt = datetime.strptime(value_str, fmt)
            return dt.strftime("%Y-%m-01")
        except ValueError:
            continue
    return None


def read_sales_file(file_path: str) -> pd.DataFrame:
    path = Path(file_path)
    if path.suffix.lower() == ".csv":
        for encoding in ["utf-8", "gbk", "gb2312", "utf-8-sig"]:
            for sep in [",", "\t", ";"]:
                try:
                    df = pd.read_csv(file_path, encoding=encoding, sep=sep)
                    if "门店" in df.columns or "时间" in df.columns:
                        break
                except (UnicodeDecodeError, pd.errors.ParserError):
                    continue
            else:
                continue
            break
        else:
            raise ValueError(f"无法读取 CSV 文件（编码/分隔符不支持）: {file_path}")
    else:
        df = pd.read_excel(file_path)
    df = df.dropna(how="all")
    if "门店" in df.columns:
        df = df[~df["门店"].astype(str).str.contains(r"^汇总[：:]", regex=True, na=False)]
    if "门店" in df.columns:
        df = df[df["门店"].notna() & (df["门店"].astype(str).str.strip() != "")]
    return df


def map_store_code(store_name: str) -> Optional[str]:
    if pd.isna(store_name) or store_name == "":
        return None
    store_name = str(store_name).strip()
    return STORE_NAME_MAPPING.get(store_name)


def transform_sales_data(df: pd.DataFrame, store_code_from_path: str) -> pd.DataFrame:
    result = pd.DataFrame()
    if "门店" in df.columns:
        result["store_name"] = df["门店"].astype(str).str.strip()
        result["store_code"] = result["store_name"].apply(map_store_code)
        result["store_code"] = result["store_code"].fillna(store_code_from_path)
    if "时间" in df.columns:
        result["month"] = df["时间"].apply(normalize_month)
    if "营业额" in df.columns:
        result["gross_sales_amt"] = df["营业额"].apply(parse_amount)
    if "优惠总额" in df.columns:
        result["discount_amt"] = df["优惠总额"].apply(parse_amount)
    if "营业收入" in df.columns:
        result["revenue_amt"] = df["营业收入"].apply(parse_amount)
    if "退款金额" in df.columns:
        result["refund_amt"] = df["退款金额"].apply(parse_amount)
    if "有效订单数" in df.columns:
        result["order_cnt"] = df["有效订单数"].apply(parse_int)
    return result


def delete_existing_data(source_file_id: int, conn):
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM bonjur_ods.sales_monthly WHERE source_file_id = %s",
            (source_file_id,),
        )
        deleted = cur.rowcount
        conn.commit()
        return deleted


def update_ingest_file_failed(source_file_id: int, error_message: str, conn):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE raw.ingest_file SET status='failed', error_message=%s, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
            (error_message, source_file_id),
        )
        conn.commit()


def dry_run_import(file_path: str) -> dict:
    print(f"\n=== Dry Run: {file_path} ===")
    meta = parse_path(file_path, SOURCE_TYPE)
    print(f"Brand Code: {meta['brand_code']}")
    print(f"Store Code: {meta['store_code']}")
    print(f"Source Type: {meta['source_type']}")
    print(f"Month: {meta['month']}")
    print(f"File Name: {meta['file_name']}")
    file_hash = calculate_sha256(file_path)
    file_size = os.path.getsize(file_path)
    print(f"File Hash: {file_hash}")
    print(f"File Size: {file_size} bytes")
    df = read_sales_file(file_path)
    print(f"\n原始行数: {len(df)} rows")
    df_transformed = transform_sales_data(df, meta["store_code"])
    print(f"转换后行数: {len(df_transformed)} rows")
    print("\n=== Data Quality Check ===")
    print(f"总行数: {len(df_transformed)}")
    missing_stats = {}
    for col in ["store_code", "store_name", "month", "gross_sales_amt", "discount_amt", "revenue_amt", "order_cnt", "refund_amt"]:
        if col in df_transformed.columns:
            null_count = df_transformed[col].isna().sum()
            if null_count > 0:
                missing_stats[col] = null_count
    if missing_stats:
        print("字段缺失统计:")
        for col, count in missing_stats.items():
            print(f"  - {col}: {count} 行缺失")
    else:
        print("✓ 所有字段完整")
    if "store_code" in df_transformed.columns:
        unmapped = df_transformed[df_transformed["store_code"].isna()]
        if len(unmapped) > 0:
            print(f"⚠️  {len(unmapped)} 行门店映射失败:")
            for name in unmapped["store_name"].unique():
                print(f"    - {name}")
    print("\n=== Sample Data (first 3 rows) ===")
    print(df_transformed.head(3).to_string())
    return {
        "meta": meta,
        "file_hash": file_hash,
        "file_size": file_size,
        "row_count": len(df_transformed),
        "missing_stats": missing_stats,
    }


def verify_import(file_path: str) -> dict:
    print(f"\n=== Verify: {file_path} ===")
    meta = parse_path(file_path, SOURCE_TYPE)
    file_hash = calculate_sha256(file_path)
    print(f"File Hash: {file_hash}")
    conn = get_connection()
    try:
        mgr = IngestFileManager(conn)
        ingest = mgr.check(file_hash)
        if not ingest:
            print("⚠️  No ingest_file record found (not imported yet)")
            return {"status": "not_imported"}
        print(f"\n=== Ingest File Record ===")
        print(f"ID: {ingest['id']}")
        print(f"Status: {ingest['status']}")
        print(f"Row Count: {ingest['row_count']}")
        print(f"Brand: {ingest.get('brand_code', 'N/A')}")
        print(f"Store: {ingest.get('store_code', 'N/A')}")
        print(f"Month: {ingest.get('month', 'N/A')}")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*), COUNT(store_code), COUNT(store_name), COUNT(month), COUNT(gross_sales_amt), COUNT(discount_amt), COUNT(revenue_amt), COUNT(order_cnt), COUNT(refund_amt) FROM bonjur_ods.sales_monthly WHERE source_file_id = %s",
                (ingest["id"],),
            )
            row = cur.fetchone()
        print(f"\n=== Sales Monthly Data ===")
        print(f"Total rows: {row[0]}")
        print(f"Non-null store_code: {row[1]}")
        print(f"Non-null store_name: {row[2]}")
        print(f"Non-null month: {row[3]}")
        print(f"Non-null gross_sales_amt: {row[4]}")
        print(f"Non-null discount_amt: {row[5]}")
        print(f"Non-null revenue_amt: {row[6]}")
        print(f"Non-null order_cnt: {row[7]}")
        print(f"Non-null refund_amt: {row[8]}")
        if row[0] != ingest["row_count"]:
            print(f"⚠️  Warning: sales_monthly rows ({row[0]}) != ingest_file.row_count ({ingest['row_count']})")
        return {
            "status": "verified",
            "ingest_id": ingest["id"],
            "ingest_status": ingest["status"],
            "sales_monthly_count": row[0],
            "expected_count": ingest["row_count"],
        }
    finally:
        conn.close()


def do_import(file_path: str) -> dict:
    print(f"\n=== Importing: {file_path} ===")
    meta = parse_path(file_path, SOURCE_TYPE)
    if meta["brand_code"] != "bonjur":
        raise ValueError(f"本脚本仅支持 bonjur 品牌，当前文件: {meta['brand_code']}")

    ops = create_ops_logger(
        brand_code=meta["brand_code"],
        store_code=meta["store_code"],
        month=meta["month"],
        triggered_by="manual",
        note=meta["file_name"],
    )

    file_hash = calculate_sha256(file_path)
    file_size = os.path.getsize(file_path)
    print(f"File Hash: {file_hash}")

    STEP_ORDER = {
        "register_file": 1,
        "delete_previous": 2,
        "load_file": 3,
        "transform": 4,
        "insert_sales": 5,
        "update_ingest_status": 6,
    }

    conn = get_connection()
    try:
        ensure_table_exists(conn, "bonjur_ods", "sales_monthly", TABLE_DDL)

        if ops:
            ops.step_start("register_file", step_order=STEP_ORDER["register_file"], detail={"file_path": file_path})

        mgr = IngestFileManager(conn)
        existing = mgr.check(file_hash)
        source_file_id = None
        if existing:
            print(f"Found existing import: id={existing['id']}, status={existing['status']}")
            source_file_id = existing["id"]
            if existing["status"] == "success":
                if ops:
                    ops.step_start("delete_previous", step_order=STEP_ORDER["delete_previous"])
                deleted = delete_existing_data(source_file_id, conn)
                print(f"Deleted {deleted} existing rows for idempotent import")
                if ops:
                    ops.step_end("delete_previous", rows_out=deleted)
            elif existing["status"] == "pending":
                print("Warning: previous import is pending, will retry")
        else:
            source_file_id = mgr.create(
                meta["brand_code"], meta["store_code"], SOURCE_TYPE,
                meta["month_date"], meta["file_name"], meta["file_path"],
                file_hash, file_size,
            )
            print(f"Created new ingest_file: id={source_file_id}")

        if ops:
            ops.step_end("register_file", rows_out=1, detail={"source_file_id": source_file_id})

        if ops:
            ops.step_start("load_file", step_order=STEP_ORDER["load_file"])
        df = read_sales_file(file_path)
        rows_parsed = len(df)
        print(f"Parsed {rows_parsed} rows from file")
        if ops:
            ops.step_end("load_file", rows_out=rows_parsed)

        if ops:
            ops.step_start("transform", step_order=STEP_ORDER["transform"], detail={"rows_in": rows_parsed})
        df_transformed = transform_sales_data(df, meta["store_code"])
        rows_transformed = len(df_transformed)
        print(f"Transformed {rows_transformed} rows")
        if ops:
            ops.step_end("transform", rows_out=rows_transformed, rows_rejected=rows_parsed - rows_transformed)

        if ops:
            ops.step_start("insert_sales", step_order=STEP_ORDER["insert_sales"], detail={"rows_in": rows_transformed})

        records = []
        for _, row in df_transformed.iterrows():
            records.append((
                row.get("store_code"), row.get("store_name"), row.get("month"),
                row.get("gross_sales_amt"), row.get("discount_amt"),
                row.get("revenue_amt"), row.get("order_cnt"), row.get("refund_amt"),
                source_file_id,
            ))
        row_count = insert_batch(conn, TARGET_TABLE, COLUMNS, records)
        print(f"Inserted {row_count} rows into bonjur_ods.sales_monthly")
        if ops:
            ops.step_end("insert_sales", rows_out=row_count, rows_rejected=rows_transformed - row_count)

        if ops:
            ops.step_start("update_ingest_status", step_order=STEP_ORDER["update_ingest_status"])
        mgr.mark_success(source_file_id, row_count)
        print(f"Updated ingest_file status to success")
        if ops:
            ops.step_end("update_ingest_status", rows_out=1)
        if ops:
            ops.finish(status="success")

        return {
            "status": "success",
            "source_file_id": source_file_id,
            "row_count": row_count,
        }
    except Exception as e:
        error_msg = str(e)
        print(f"Error: {error_msg}")
        if ops:
            ops.step_end("insert_sales", status="failed", error_message=error_msg[:500])
            ops.finish(status="failed", note=error_msg[:500])
        if source_file_id:
            update_ingest_file_failed(source_file_id, error_msg[:1000], conn)
        raise
    finally:
        conn.close()
        if ops:
            ops.close()


def main():
    parser = setup_cli_parser("Bonjur 营业数据导入脚本")
    args = parser.parse_args()

    input_path = args.input
    if os.path.isdir(input_path):
        files = find_sales_files(input_path)
        if not files:
            print(f"No sales files found in: {input_path}")
            sys.exit(1)
        print(f"Found {len(files)} files to process")
    else:
        files = [input_path]

    if args.dry_run:
        for f in files:
            dry_run_import(f)
    elif args.verify:
        for f in files:
            verify_import(f)
    else:
        for f in files:
            result = do_import(f)
            print(f"\n✓ Import completed: {result['row_count']} rows, source_file_id={result['source_file_id']}")


if __name__ == "__main__":
    main()
