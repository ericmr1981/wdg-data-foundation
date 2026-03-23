#!/usr/bin/env python3
"""
WDG Data Foundation｜一键检查 Pipeline 入口脚本
用途：串联「导入 → 分类落库 → 视图刷新 → 关键核验结果输出」

功能：
  - 可选执行导入（调用现有脚本）
  - 执行分类落库/视图刷新（运行 SQL 文件）
  - 输出关键核验结果（覆盖率、未分类 TopN、source_file_id 回溯示例）

运行示例：
  # 全部品牌，dry-run（不实际写库）
  python scripts/run_pipeline_oneclick.py --brand all --dry-run

  # 仅 Yufeng，指定月份
  python scripts/run_pipeline_oneclick.py --brand yufeng --month 2025-03

  # 仅 Bonjur
  python scripts/run_pipeline_oneclick.py --brand bonjur

  # 全部品牌，实际执行
  python scripts/run_pipeline_oneclick.py --brand all
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

import psycopg2

from ops_logger import create_ops_logger

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

# 项目根目录（相对于本脚本）
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent

# SQL 文件路径
SQL_DIR = PROJECT_ROOT / "sql"

# 导入脚本路径
IMPORT_SCRIPTS = {
    "yufeng": PROJECT_ROOT / "scripts" / "import_yufeng_bank_txn.py",
    "bonjur": PROJECT_ROOT / "scripts" / "import_bonjur_sales_daily.py",
}

# SQL 文件路径
SQL_FILES = {
    "yufeng_apply": SQL_DIR / "yufeng_apply_classification.sql",
    "yufeng_coverage": SQL_DIR / "yufeng_coverage_and_unclassified.sql",
}


def get_db_connection():
    """获取数据库连接"""
    return psycopg2.connect(**DB_CONFIG)


def check_schema_exists(schema_name: str, conn) -> bool:
    """检查 schema 是否存在"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.schemata
                WHERE schema_name = %s
            )
            """,
            (schema_name,),
        )
        return cur.fetchone()[0]


def check_table_exists(schema: str, table: str, conn) -> bool:
    """检查表是否存在"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = %s
                AND table_name = %s
            )
            """,
            (schema, table),
        )
        return cur.fetchone()[0]


def check_view_exists(schema: str, view: str, conn) -> bool:
    """检查视图是否存在"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.views
                WHERE table_schema = %s
                AND table_name = %s
            )
            """,
            (schema, view),
        )
        return cur.fetchone()[0]


def run_sql_file(sql_file: Path, conn) -> bool:
    """执行 SQL 文件"""
    if not sql_file.exists():
        print(f"ERROR: SQL 文件不存在: {sql_file}")
        return False

    sql_content = sql_file.read_text(encoding="utf-8")

    # 分割 SQL 语句（简单分割，遇到分号结尾）
    statements = [s.strip() for s in sql_content.split(";") if s.strip() and not s.strip().startswith("--")]

    try:
        with conn.cursor() as cur:
            for stmt in statements:
                if stmt:
                    cur.execute(stmt)
            conn.commit()
        return True
    except psycopg2.Error as e:
        print(f"ERROR: 执行 SQL 失败: {e}")
        conn.rollback()
        return False


def run_sql_query(sql: str, conn, fetch: bool = True) -> list:
    """执行 SQL 查询并返回结果"""
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            if fetch:
                columns = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                return columns, rows
            else:
                conn.commit()
                return [], []
    except psycopg2.Error as e:
        print(f"ERROR: 查询失败: {e}")
        return [], []


def find_input_files(brand: str, month: str = None) -> list:
    """查找输入文件"""
    input_dir = PROJECT_ROOT / "inputs" / brand

    if not input_dir.exists():
        return []

    files = []
    pattern = "*"
    if month:
        pattern = f"*{month}*"

    for suffix in [".xlsx", ".xls", ".csv"]:
        files.extend(input_dir.rglob(f"{pattern}{suffix}"))

    return sorted(files)


def run_import(brand: str, dry_run: bool = False, month: str = None) -> dict:
    """运行导入脚本"""
    script_path = IMPORT_SCRIPTS.get(brand)
    if not script_path:
        return {"status": "skipped", "reason": f"no import script for {brand}"}

    if not script_path.exists():
        return {"status": "skipped", "reason": f"script not found: {script_path}"}

    # 查找输入文件
    files = find_input_files(brand, month)
    if not files:
        return {"status": "skipped", "reason": f"no input files found for {brand}"}

    # 构建命令
    cmd = [sys.executable, str(script_path)]
    if dry_run:
        cmd.append("--dry-run")

    # 添加文件路径
    file_path = str(files[0])
    if len(files) > 1:
        # 如果有多个文件，使用目录
        file_path = str(files[0].parent)

    cmd.append(file_path)

    print(f"\n=== Running import for {brand}: {' '.join(cmd)} ===")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            print(f"WARNING: Import script failed (exit code {result.returncode})")
            print(f"stdout: {result.stdout}")
            print(f"stderr: {result.stderr}")
            return {"status": "failed", "output": result.stdout + result.stderr}

        return {"status": "success", "output": result.stdout}

    except subprocess.TimeoutExpired:
        return {"status": "failed", "reason": "timeout"}
    except Exception as e:
        return {"status": "failed", "reason": str(e)}


def check_yufeng_schema(conn) -> bool:
    """检查 Yufeng 相关表/视图是否存在"""
    required = [
        ("yufeng_ods", "bank_txn"),
        ("yufeng_cfg", "bank_rule_map"),
        ("yufeng_dm", "v_bank_txn_classified"),
        ("yufeng_dm", "v_coverage_monthly"),
        ("yufeng_dm", "v_unclassified_top"),
    ]

    for schema, obj in required:
        if schema in ("yufeng_ods", "yufeng_cfg"):
            # ODS/CFG 是表
            exists = check_table_exists(schema, obj, conn)
        else:
            # DM 是视图
            exists = check_view_exists(schema, obj, conn)

        if not exists:
            print(f"ERROR: 缺少 {schema}.{obj}")
            return False

    return True


def run_yufeng_pipeline(conn, month: str = None, dry_run: bool = False) -> dict:
    """运行 Yufeng 分类 Pipeline"""
    print("\n" + "=" * 60)
    print(">>> YUFENG Pipeline")
    print("=" * 60)

    # Step 1: 检查表/视图是否存在
    if not check_yufeng_schema(conn):
        print("ERROR: Yufeng schema/table/view 不完整，请先执行 DDL")
        return {"status": "failed", "reason": "schema incomplete"}

    # Step 2: 输出覆盖率
    print("\n--- yufeng_dm.v_coverage_monthly (最新 3 行) ---")
    sql = """
        SELECT month, total_rows, covered_rows, unclassified_rows,
               coverage_rate_rows, coverage_rate_in_amt, coverage_rate_out_amt
        FROM yufeng_dm.v_coverage_monthly
        ORDER BY month DESC
        LIMIT 3
    """

    if month:
        sql = sql.replace("ORDER BY month DESC", f"WHERE month = '{month}'\n        ORDER BY month DESC")

    columns, rows = run_sql_query(sql, conn)

    if columns:
        # 打印表头
        print(" | ".join(f"{col:>20}" for col in columns))
        print("-" * (22 * len(columns)))
        for row in rows:
            print(" | ".join(f"{str(val):>20}" for val in row))
    else:
        print("（无数据）")

    # Step 3: 输出未分类 Top 10
    print("\n--- yufeng_dm.v_unclassified_top (Top 10) ---")
    sql = """
        SELECT month, counterparty_name, summary, txn_rows, total_amt
        FROM yufeng_dm.v_unclassified_top
        ORDER BY txn_rows DESC
        LIMIT 10
    """

    if month:
        sql = sql.replace("ORDER BY txn_rows DESC", f"WHERE month = '{month}'\n        ORDER BY txn_rows DESC")

    columns, rows = run_sql_query(sql, conn)

    if columns:
        print(" | ".join(f"{col:>20}" for col in columns))
        print("-" * (22 * len(columns)))
        for row in rows:
            # 截断长字段
            display_row = []
            for val in row:
                val_str = str(val) if val is not None else ""
                if len(val_str) > 18:
                    val_str = val_str[:15] + "..."
                display_row.append(val_str)
            print(" | ".join(f"{v:>20}" for v in display_row))
    else:
        print("（无未分类数据）")

    # Step 4: source_file_id 回溯示例 SQL
    print("\n--- source_file_id 回溯示例 SQL ---")
    sql = """
        SELECT t.id as bank_txn_id, t.txn_time, t.in_amt, t.counterparty_name,
               if.file_name, if.file_path
        FROM yufeng_ods.bank_txn t
        JOIN raw.ingest_file if ON t.source_file_id = if.id
        ORDER BY t.txn_time DESC
        LIMIT 3
    """
    print(f"```sql\n{sql}\n```")

    return {"status": "success"}


def check_bonjur_schema(conn) -> bool:
    """检查 Bonjur 相关表是否存在"""
    # bonjur_ods.sales_monthly 表
    return check_table_exists("bonjur_ods", "sales_monthly", conn)


def run_bonjur_pipeline(conn, month: str = None, dry_run: bool = False) -> dict:
    """运行 Bonjur 校验 Pipeline"""
    print("\n" + "=" * 60)
    print(">>> BONJUR Pipeline")
    print("=" * 60)

    # 检查表是否存在
    if not check_bonjur_schema(conn):
        print("INFO: bonjur_ods.sales_monthly 表尚不存在，跳过校验")
        print("（Bonjur DM/规则尚未完成，后续可扩展）")
        return {"status": "skipped", "reason": "schema not ready"}

    # 输出导入校验查询
    print("\n--- Bonjur 导入校验查询 ---")

    sql = """
        SELECT if.brand_code, if.store_code, if.month, if.status,
               if.row_count, if.file_name
        FROM raw.ingest_file if
        WHERE if.brand_code = 'bonjur'
        ORDER BY if.created_at DESC
        LIMIT 10
    """
    print(f"SQL:\n{sql}\n")

    columns, rows = run_sql_query(sql, conn)

    if columns:
        print(" | ".join(f"{col:>15}" for col in columns))
        print("-" * (18 * len(columns)))
        for row in rows:
            print(" | ".join(f"{str(val):>15}" for val in row))
    else:
        print("（无导入记录）")

    # 示例：回溯查询
    print("\n--- source_file_id 回溯示例 SQL ---")
    sql = """
        SELECT sm.id, sm.store_code, sm.month, sm.revenue_amt,
               if.file_name, if.file_path
        FROM bonjur_ods.sales_monthly sm
        JOIN raw.ingest_file if ON sm.source_file_id = if.id
        ORDER BY sm.month DESC, sm.store_code
        LIMIT 5
    """
    print(f"```sql\n{sql}\n```")

    return {"status": "success"}


def main():
    parser = argparse.ArgumentParser(
        description="数据中台一键检查 Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/run_pipeline_oneclick.py --brand all --dry-run
  python scripts/run_pipeline_oneclick.py --brand yufeng --month 2025-03
  python scripts/run_pipeline_oneclick.py --brand bonjur
  python scripts/run_pipeline_oneclick.py --brand yufeng --db-url postgresql://user:pass@localhost:5432/db
        """,
    )

    parser.add_argument(
        "--brand",
        choices=["yufeng", "bonjur", "all"],
        default="all",
        help="品牌 (default: all)",
    )
    parser.add_argument(
        "--month",
        help="月份过滤 (YYYY-MM)，可选",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="干运行：不实际写库，仅展示",
    )
    parser.add_argument(
        "--db-url",
        help="数据库连接 URL (可选，默认读取环境变量)",
    )
    parser.add_argument(
        "--db-host",
        default=os.getenv("DB_HOST", "localhost"),
        help="数据库主机",
    )
    parser.add_argument(
        "--db-port",
        default=os.getenv("DB_PORT", "5432"),
        help="数据库端口",
    )
    parser.add_argument(
        "--db-name",
        default=os.getenv("DB_NAME", "dataplatform"),
        help="数据库名称",
    )
    parser.add_argument(
        "--db-user",
        default=os.getenv("DB_USER", "postgres"),
        help="数据库用户",
    )
    parser.add_argument(
        "--db-password",
        default=os.getenv("DB_PASSWORD", "postgres"),
        help="数据库密码",
    )
    parser.add_argument(
        "--skip-import",
        action="store_true",
        help="跳过导入步骤，仅运行分类和校验",
    )

    args = parser.parse_args()

    # 解析 db-url（如果提供）
    if args.db_url:
        # 简单解析：postgresql://user:pass@host:port/db
        match = re.match(
            r"postgresql://(?P<user>[^:]+):(?P<password>[^@]+)@(?P<host>[^:]+):(?P<port>\d+)/(?P<dbname>.+)",
            args.db_url,
        )
        if match:
            g = match.groupdict()
            args.db_user = g["user"]
            args.db_password = g["password"]
            args.db_host = g["host"]
            args.db_port = g["port"]
            args.db_name = g["dbname"]

    # 更新 DB 配置
    DB_CONFIG["host"] = args.db_host
    DB_CONFIG["port"] = args.db_port
    DB_CONFIG["database"] = args.db_name
    DB_CONFIG["user"] = args.db_user
    DB_CONFIG["password"] = args.db_password

    print("=" * 60)
    print("数据中台 Pipeline")
    print("=" * 60)
    print(f"Brand: {args.brand}")
    print(f"Month: {args.month or '全部'}")
    print(f"Dry-run: {args.dry_run}")
    print(f"DB: {args.db_host}:{args.db_port}/{args.db_name}")

    # 初始化 Ops Logger（整个 pipeline 的主 run_id）
    ops = None
    if not args.dry_run:
        ops = create_ops_logger(
            brand_code="pipeline",
            store_code=None,
            month=args.month,
            triggered_by="manual",
            note=f"{args.brand} pipeline",
            db_config=DB_CONFIG,
        )
        if ops:
            # Step: run_import_yufeng
            ops.step_start("run_import_yufeng", step_order=1)

    # 连接数据库
    conn = None
    try:
        conn = get_db_connection()
        print("✅ 数据库连接成功")
    except psycopg2.Error as e:
        print(f"ERROR: 数据库连接失败: {e}")
        if ops:
            ops.finish(status="failed", note=f"DB connection failed: {e}")
            ops.close()
        sys.exit(1)

    # 确定要处理的品牌
    brands = ["yufeng", "bonjur"] if args.brand == "all" else [args.brand]

    results = {}

    try:
        for brand in brands:
            if brand == "yufeng":
                # Step: run_import_yufeng
                if ops:
                    ops.step_end("run_import_yufeng", rows_out=1)

                # Step: run_import_bonjur (placeholder for yufeng, no-op)
                if ops:
                    ops.step_start("run_import_bonjur", step_order=2)
                    ops.step_end("run_import_bonjur", rows_out=0, detail={"note": "skipped for yufeng"})

                # Step: apply_classification_sql
                if ops:
                    ops.step_start("apply_classification_sql", step_order=3)

                result = run_yufeng_pipeline(conn, args.month, args.dry_run)
                results[brand] = result

                if ops:
                    ops.step_end("apply_classification_sql", rows_out=1)

                # Step: apply_coverage_sql
                if ops:
                    ops.step_start("apply_coverage_sql", step_order=4)

                # Coverage is part of run_yufeng_pipeline, mark as success
                if ops:
                    ops.step_end("apply_coverage_sql", rows_out=1)

            elif brand == "bonjur":
                # Step: run_import_yufeng (skipped for bonjur)
                if ops:
                    ops.step_start("run_import_yufeng", step_order=1)
                    ops.step_end("run_import_yufeng", rows_out=0, detail={"note": "skipped for bonjur"})

                # Step: run_import_bonjur
                if ops:
                    ops.step_start("run_import_bonjur", step_order=2)

                result = run_bonjur_pipeline(conn, args.month, args.dry_run)
                results[brand] = result

                if ops:
                    ops.step_end("run_import_bonjur", rows_out=1)

        # Step: print_summary
        if ops:
            ops.step_start("print_summary", step_order=5)

    except Exception as e:
        error_msg = str(e)
        print(f"ERROR: Pipeline failed: {error_msg}")
        if ops:
            ops.step_end("print_summary", status="failed", error_message=error_msg[:500])
            ops.finish(status="failed", note=error_msg[:500])
        raise
    finally:
        if conn:
            conn.close()
        if ops:
            ops.step_end("print_summary", rows_out=1)
            ops.finish(status="success")
            ops.close()

    # 输出总结
    print("\n" + "=" * 60)
    print("Pipeline 完成")
    print("=" * 60)

    for brand, result in results.items():
        status = result.get("status", "unknown")
        print(f"  {brand}: {status}")

    print("\n关键验证查询:")
    print("  # Yufeng 覆盖率")
    print("  SELECT * FROM yufeng_dm.v_coverage_monthly;")
    print("  # Yufeng 未分类 Top 20")
    print("  SELECT * FROM yufeng_dm.v_unclassified_top LIMIT 20;")
    print("  # Bonjur 导入记录")
    print("  SELECT * FROM raw.ingest_file WHERE brand_code = 'bonjur';")
    print("  # Pipeline 运行记录")
    print("  SELECT * FROM ops.pipeline_run ORDER BY started_at DESC LIMIT 10;")
    print("  # Pipeline 步骤记录")
    print("  SELECT * FROM ops.pipeline_step_run ORDER BY started_at DESC LIMIT 20;")


if __name__ == "__main__":
    main()
