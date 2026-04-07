#!/usr/bin/env python3
"""
Xintiandi 配送明细 Excel 导入脚本
用途：将新天地门店的配送/库存 Excel 文件导入到 xintiandi.delivery_detail 表

输入：
  - Excel 文件（.xlsx）
  - 目录路径：按 inputs/ 约定支持多门店路径格式
  - 预期字段：配送单号, 门店编码, 门店名称, 创建时间, 品项名称, 品项编码, 
             品项分类, 订货数量, 审核数量, 发货数量, 送达数量, 订货金额

功能：
  - 支持从路径解析元数据：inputs/{brand}/{store}/delivery/{YYYY-MM}/{filename}
  - 解析 Excel 文件
  - 幂等导入（按 delivery_no + item_code 去重）
  - 自动刷新月度汇总表
  - 记录导入批次

Usage:
  # 从标准路径导入（自动解析门店和月份）
  python3 scripts/import_xintiandi_delivery.py inputs/xintiandi/sh_xtd_nano/delivery/2026-03/配送明细.xlsx
  
  # 指定门店覆盖（兼容旧方式）
  python3 scripts/import_xintiandi_delivery.py inputs/xintiandi/sh_xtd_nano/delivery/2026-03/配送明细.xlsx --store-code xtd_002 --store-name "新天地二期店"
  
  # 目录批量导入
  python3 scripts/import_xintiandi_delivery.py inputs/xintiandi/sh_xtd_nano/delivery/2026-03/
  
  # 仅解析不导入
  python3 scripts/import_xintiandi_delivery.py inputs/xintiandi/sh_xtd_nano/delivery/2026-03/配送明细.xlsx --dry-run
"""

import argparse
import hashlib
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# =====================
# 配置
# =====================
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "dataplatform"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}

# Excel 列名映射
COLUMN_MAPPING = {
    "配送单号": "delivery_no",
    "门店编码": "store_code",
    "门店名称": "store_name",
    "创建时间": "created_time",
    "品项名称": "item_name",
    "品项编码": "item_code",
    "品项分类": "item_category",
    "订货数量": "order_qty",
    "审核数量": "audit_qty",
    "发货数量": "ship_qty",
    "送达数量": "deliver_qty",
    "订货金额": "order_amt",
}


def parse_path(file_path: str) -> dict:
    """
    从文件路径解析元数据（遵循 bank/sales 导入脚本的路径约定）
    
    路径格式：
      inputs/{brand_code}/{store_code}/delivery/{YYYY-MM}/{filename}
      inputs/xintiandi/sh_xtd_nano/delivery/2026-03/配送明细.xlsx
    
    返回：
      {
        "brand_code": str,
        "store_code": str,
        "source_type": "delivery",
        "month": "YYYY-MM",
        "month_date": "YYYY-MM-01",
        "file_name": str,
        "file_path": str,
      }
    
    备选路径格式（兼容旧版 xintiandi 直接上传）：
      inputs/xintiandi/delivery/{YYYY-MM}/{filename}
    """
    path = Path(file_path)
    parts = path.parts

    # 检查基础路径
    if "inputs" not in parts:
        raise ValueError(f"路径必须包含 'inputs' 目录: {file_path}")

    idx = parts.index("inputs")
    
    # 尝试标准格式: inputs/{brand}/{store}/delivery/{YYYY-MM}/{filename}
    if len(parts) >= idx + 6:
        brand_code = parts[idx + 1]
        store_code = parts[idx + 2]
        source_type = parts[idx + 3]
        month_str = parts[idx + 4]
        file_name = parts[-1]
        
        # 验证 source_type 必须是 delivery
        if source_type != "delivery":
            raise ValueError(f"source_type 必须是 'delivery': {source_type}")
        
        # 验证月份格式
        if not re.match(r"^\d{4}-\d{2}$", month_str):
            raise ValueError(f"月份格式错误 (需 YYYY-MM): {month_str}")
        
        return {
            "brand_code": brand_code,
            "store_code": store_code,
            "store_name": store_code,  # store_name 由 DB lookup 填充；此处用 store_code 作为保底值
            "source_type": source_type,
            "month": month_str,
            "month_date": f"{month_str}-01",
            "file_name": file_name,
            "file_path": file_path,
        }
    
    # 备选旧格式: inputs/{brand}/delivery/{YYYY-MM}/{filename}
    # 兼容 xintiandi/upload 直接上传的场景
    if len(parts) >= idx + 5:
        brand_code = parts[idx + 1]
        source_type = parts[idx + 2]
        month_str = parts[idx + 3]
        file_name = parts[-1]
        
        if source_type != "delivery":
            raise ValueError(f"source_type 必须是 'delivery': {source_type}")
        
        if not re.match(r"^\d{4}-\d{2}$", month_str):
            raise ValueError(f"月份格式错误 (需 YYYY-MM): {month_str}")
        
        # 对于旧格式，无法确定 store_code，返回 brand_code 作为标识
        return {
            "brand_code": brand_code,
            "store_code": brand_code,  # fallback to brand_code
            "store_name": brand_code,  # fallback store_name 同 store_code
            "source_type": source_type,
            "month": month_str,
            "month_date": f"{month_str}-01",
            "file_name": file_name,
            "file_path": file_path,
        }
    
    raise ValueError(
        f"路径格式错误。期望: inputs/{{brand}}/{{store}}/delivery/{{YYYY-MM}}/{{filename}}\n"
        f"实际路径: {file_path}"
    )


def find_delivery_files(input_path: str) -> list[str]:
    """
    递归查找配送明细文件
    支持：xlsx, xls, csv
    """
    path = Path(input_path)
    files = []

    if path.is_file():
        if path.suffix.lower() in (".xlsx", ".xls", ".csv"):
            files.append(str(path))
    else:
        # 递归查找 {brand}/{store}/delivery/YYYY-MM/* 下的数据文件
        for subpath in path.rglob("*"):
            if subpath.is_file() and subpath.suffix.lower() in (".xlsx", ".xls", ".csv"):
                # 检查路径是否符合约定
                try:
                    parse_path(str(subpath))
                    files.append(str(subpath))
                except ValueError:
                    continue

    return sorted(files)


def parse_args():
    parser = argparse.ArgumentParser(description="Xintiandi 配送明细导入")
    parser.add_argument("file", help="Excel 文件路径或目录路径")
    parser.add_argument("--dry-run", action="store_true", help="仅解析不导入")
    parser.add_argument("--batch-id", help="指定批次ID（可选，自动生成）")
    parser.add_argument("--store-code", default=None, help="门店编码（可选，从路径解析，优先级高于路径）")
    parser.add_argument("--store-name", default=None, help="门店名称（可选，从路径解析，优先级高于路径）")
    return parser.parse_args()


def parse_excel(file_path: str, default_store_code: str = None, default_store_name: str = None) -> pd.DataFrame:
    """解析 Excel 文件并标准化列名"""
    try:
        df = pd.read_excel(file_path, engine="openpyxl")
    except Exception as e:
        try:
            df = pd.read_excel(file_path, engine="xlrd")
        except Exception as e2:
            raise ValueError(f"无法解析 Excel 文件: {e2}")
    
    # 重命名列
    df = df.rename(columns=COLUMN_MAPPING)
    
    # 检查必需字段
    required = ["delivery_no", "item_code"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(f"缺少必需字段: {missing}")
    
    # 类型转换
    if "created_time" in df.columns:
        df["created_time"] = pd.to_datetime(df["created_time"], errors="coerce")
    
    numeric_cols = ["order_qty", "audit_qty", "ship_qty", "deliver_qty", "order_amt"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    
    # 空字符串转 NULL
    df = df.replace("", None)
    
    # 填充门店信息（优先使用命令行参数，其次使用路径元数据）
    if "store_code" in df.columns:
        # 如果命令行指定了 store_code，优先使用
        fill_value = default_store_code if default_store_code else df["store_code"].mode()[0] if not df["store_code"].isna().all() else None
        df["store_code"] = df["store_code"].fillna(fill_value) if fill_value else df["store_code"]
    elif default_store_code:
        df["store_code"] = default_store_code
    
    if "store_name" in df.columns:
        fill_value = default_store_name if default_store_name else df["store_name"].mode()[0] if not df["store_name"].isna().all() else None
        df["store_name"] = df["store_name"].fillna(fill_value) if fill_value else df["store_name"]
    elif default_store_name:
        df["store_name"] = default_store_name
    
    return df


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def delete_existing_batch(conn, batch_id: uuid.UUID):
    """删除指定批次的数据（幂等用）"""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM xintiandi.delivery_detail WHERE import_batch = %s",
            (batch_id,)
        )
        return cur.rowcount


def import_data(conn, df: pd.DataFrame, batch_id: uuid.UUID, file_name: str, dry_run: bool = False):
    """导入数据到数据库"""
    if dry_run:
        print(f"[DRY-RUN] 将导入 {len(df)} 行数据")
        print(df.head(5).to_string())
        return 0, 0
    
    rows_imported = 0
    rows_error = 0
    
    # 构建插入数据
    records = []
    for _, row in df.iterrows():
        try:
            created_time = row.get("created_time")
            if pd.isna(created_time):
                created_time = None
            elif isinstance(created_time, str):
                created_time = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
            elif hasattr(created_time, 'to_pydatetime'):
                created_time = created_time.to_pydatetime()
            
            records.append((
                row.get("delivery_no"),
                row.get("store_code"),
                row.get("store_name"),
                created_time,
                row.get("item_name"),
                row.get("item_code"),
                row.get("item_category"),
                float(row.get("order_qty", 0) or 0),
                float(row.get("audit_qty", 0) or 0),
                float(row.get("ship_qty", 0) or 0),
                float(row.get("deliver_qty", 0) or 0),
                float(row.get("order_amt", 0) or 0),
                file_name,
                batch_id,
            ))
        except Exception as e:
            rows_error += 1
            print(f"Row error: {e}", file=sys.stderr)
    
    if records:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO xintiandi.delivery_detail (
                    delivery_no, store_code, store_name, created_time,
                    item_name, item_code, item_category,
                    order_qty, audit_qty, ship_qty, deliver_qty, order_amt,
                    source_file, import_batch
                ) VALUES %s
                ON CONFLICT (delivery_no, item_code) DO UPDATE SET
                    store_name = EXCLUDED.store_name,
                    created_time = EXCLUDED.created_time,
                    item_name = EXCLUDED.item_name,
                    item_category = EXCLUDED.item_category,
                    order_qty = EXCLUDED.order_qty,
                    audit_qty = EXCLUDED.audit_qty,
                    ship_qty = EXCLUDED.ship_qty,
                    deliver_qty = EXCLUDED.deliver_qty,
                    order_amt = EXCLUDED.order_amt,
                    source_file = EXCLUDED.source_file,
                    import_batch = EXCLUDED.import_batch,
                    import_time = NOW()
                """,
                records,
                template="""
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
            )
            rows_imported = len(records)
    
    return rows_imported, rows_error


def refresh_monthly_summary(conn, year_month: str, batch_id: uuid.UUID | str):
    """刷新月度汇总表"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT xintiandi.refresh_monthly_summary(%s, %s::uuid)",
            (year_month, str(batch_id))
        )


def update_batch_status(conn, batch_id: uuid.UUID | str, status: str, 
                        total_rows: int = None, success_rows: int = None, 
                        error_rows: int = None, error_message: str = None):
    """更新批次状态"""
    with conn.cursor() as cur:
        finished_at = "NOW()" if status in ("completed", "failed") else "NULL"
        cur.execute(f"""
            UPDATE xintiandi.import_batch SET
                status = %s,
                total_rows = COALESCE(%s, total_rows),
                success_rows = COALESCE(%s, success_rows),
                error_rows = COALESCE(%s, error_rows),
                error_message = %s,
                finished_at = {finished_at}
            WHERE batch_id = %s::uuid
        """, (status, total_rows, success_rows, error_rows, error_message, str(batch_id)))


def process_file(file_path: str, args) -> dict:
    """处理单个文件，返回处理结果"""
    file_path = Path(file_path)
    
    if not file_path.exists():
        return {"file": str(file_path), "error": "文件不存在"}
    
    # 解析路径元数据
    try:
        path_meta = parse_path(str(file_path))
    except ValueError as e:
        return {"file": str(file_path), "error": str(e)}
    
    # 命令行参数优先于路径元数据
    store_code = args.store_code if args.store_code else path_meta.get("store_code")
    store_name = args.store_name if args.store_name else path_meta.get("store_name")
    year_month = path_meta.get("month")
    
    batch_id = uuid.UUID(args.batch_id) if args.batch_id else uuid.uuid4()
    batch_id_str = str(batch_id)
    file_name = file_path.name
    file_size = file_path.stat().st_size
    
    print(f"\n处理文件: {file_path}")
    print(f"  批次ID: {batch_id}")
    print(f"  品牌: {path_meta.get('brand_code')}")
    print(f"  门店: {store_code}")
    print(f"  月份: {year_month}")
    
    # 解析 Excel
    try:
        df = parse_excel(str(file_path), default_store_code=store_code, default_store_name=store_name)
        print(f"  解析到 {len(df)} 行数据")
    except Exception as e:
        print(f"  解析失败: {e}", file=sys.stderr)
        return {"file": str(file_path), "error": f"解析失败: {e}"}
    
    if args.dry_run:
        print("\n=== DRY RUN ===")
        import_data(None, df, batch_id, file_name, dry_run=True)
        return {"file": str(file_path), "dry_run": True, "rows": len(df)}
    
    # 数据库导入
    conn = get_connection()
    try:
        # 创建批次记录
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO xintiandi.import_batch (batch_id, file_name, file_size, total_rows, status)
                VALUES (%s::uuid, %s, %s, %s, 'processing')
                ON CONFLICT (batch_id) DO UPDATE SET
                    file_name = EXCLUDED.file_name,
                    file_size = EXCLUDED.file_size,
                    total_rows = EXCLUDED.total_rows,
                    status = 'processing'
            """, (batch_id_str, file_name, file_size, len(df)))
        conn.commit()
        
        # 导入数据
        success_rows, error_rows = import_data(conn, df, batch_id_str, file_name)
        conn.commit()
        
        # 刷新月度汇总
        if success_rows > 0 and year_month:
            refresh_monthly_summary(conn, year_month, batch_id_str)
            conn.commit()
        
        # 更新批次状态
        update_batch_status(conn, batch_id_str, "completed", len(df), success_rows, error_rows)
        conn.commit()
        
        result = {
            "file": str(file_path),
            "success": True,
            "total_rows": len(df),
            "success_rows": success_rows,
            "error_rows": error_rows,
            "year_month": year_month,
            "store_code": store_code,
        }
        
        print(f"\n  导入完成!")
        print(f"    总行数: {len(df)}")
        print(f"    成功: {success_rows}")
        print(f"    错误: {error_rows}")
        print(f"    月度汇总已刷新: {year_month}")
        
        return result
        
    except Exception as e:
        update_batch_status(conn, batch_id_str, "failed", error_message=str(e))
        conn.commit()
        print(f"  导入失败: {e}", file=sys.stderr)
        return {"file": str(file_path), "error": str(e)}
    finally:
        conn.close()


if __name__ == "__main__":
    args = parse_args()
    input_path = Path(args.file)
    
    # 如果是目录，查找所有配送文件
    if input_path.is_dir():
        files = find_delivery_files(str(input_path))
        if not files:
            print(f"在目录中未找到配送明细文件: {input_path}", file=sys.stderr)
            sys.exit(1)
        
        print(f"找到 {len(files)} 个配送明细文件")
        
        results = []
        for f in files:
            result = process_file(f, args)
            results.append(result)
        
        # 汇总
        success_count = sum(1 for r in results if r.get("success"))
        error_count = sum(1 for r in results if r.get("error"))
        
        print(f"\n=== 批量导入完成 ===")
        print(f"  成功: {success_count}")
        print(f"  失败: {error_count}")
        
        if error_count > 0:
            print("\n失败文件:")
            for r in results:
                if r.get("error"):
                    print(f"  - {r['file']}: {r['error']}")
        
        sys.exit(0 if error_count == 0 else 1)
    else:
        # 单文件处理
        result = process_file(str(input_path), args)
        
        if result.get("error"):
            sys.exit(1)
        
        if not result.get("dry_run"):
            print(f"\n导入完成!")
            print(f"  总行数: {result.get('total_rows')}")
            print(f"  成功: {result.get('success_rows')}")
            print(f"  错误: {result.get('error_rows')}")
            print(f"  月度汇总已刷新: {result.get('year_month')}")
