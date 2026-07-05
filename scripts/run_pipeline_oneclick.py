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

  # 仅 Gelatomiiix，指定月份
  python scripts/run_pipeline_oneclick.py --brand gelatomiiix --month 2026-01

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

from ops_logger import create_ops_logger, pipeline_step

# =====================
# 配置
# =====================
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "dataplatform"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.environ["DB_PASSWORD"],
}

# 项目根目录（相对于本脚本）
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent

# SQL 文件路径
SQL_DIR = PROJECT_ROOT / "sql"

# 导入脚本路径
IMPORT_SCRIPTS = {
    "gelatomiiix": PROJECT_ROOT / "scripts" / "import_yufeng_bank_txn.py",
    "bonjur": PROJECT_ROOT / "scripts" / "import_bonjur_sales_daily.py",
    "tamkoko": PROJECT_ROOT / "scripts" / "import_tamkoko_income_detail.py",
}

# Schema names per brand
BRAND_SCHEMAS = {
    "gelatomiiix": {"ods": "brand_gelatomiiix_ods", "cfg": "brand_gelatomiiix_cfg", "dm": "brand_gelatomiiix_dm"},
    "bonjur": {"ods": "bonjur_ods", "cfg": "bonjur_cfg", "dm": "bonjur_dm"},
    "tamkoko": {"ods": "brand_tamkoko_ods", "cfg": "brand_tamkoko_cfg", "dm": "brand_tamkoko_dm"},
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
        conn.rollback()  # reset aborted transaction
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


def check_brand_schema(schemas: dict, conn) -> bool:
    """检查品牌的 ODS/CFG/DM 表/视图是否存在"""
    required = [
        (schemas["ods"], "bank_txn", False),       # 表
        (schemas["cfg"], "bank_rule_map", False),   # 表
        (schemas["dm"], "v_bank_txn_classified", True),   # 视图
    ]

    for schema, obj, is_view in required:
        exists = check_view_exists(schema, obj, conn) if is_view else check_table_exists(schema, obj, conn)
        if not exists:
            print(f"ERROR: 缺少 {schema}.{obj}")
            return False

    return True


def run_brand_pipeline(brand: str, schemas: dict, conn, month: str = None, dry_run: bool = False) -> dict:
    """运行品牌分类 Pipeline（通用，按品牌名和 schema 映射）"""
    label = brand.upper()
    ods, cfg, dm = schemas["ods"], schemas["cfg"], schemas["dm"]

    print("\n" + "=" * 60)
    print(f">>> {label} Pipeline ({brand})")
    print("=" * 60)

    # Step 1: 检查表/视图是否存在
    if not check_brand_schema(schemas, conn):
        print(f"ERROR: {label} schema/table/view 不完整")
        return {"status": "failed", "reason": "schema incomplete"}

    # Step 2: 输出覆盖率
    print(f"\n--- {dm}.v_coverage_monthly (最新 3 行) ---")
    sql = f"""
        SELECT month, total_rows, covered_rows, unclassified_rows,
               coverage_rate_rows, coverage_rate_in_amt, coverage_rate_out_amt
        FROM {dm}.v_coverage_monthly
        ORDER BY month DESC
        LIMIT 3
    """

    if month:
        sql = sql.replace("ORDER BY month DESC", f"WHERE month = '{month}'\n        ORDER BY month DESC")

    columns, rows = run_sql_query(sql, conn)

    if columns:
        print(" | ".join(f"{col:>20}" for col in columns))
        print("-" * (22 * len(columns)))
        for row in rows:
            print(" | ".join(f"{str(val):>20}" for val in row))
    else:
        print("（无数据）")

    # Step 3: 输出未分类 Top 10
    print(f"\n--- {dm}.v_unclassified_top (Top 10) ---")
    sql = f"""
        SELECT month, counterparty_name, summary, txn_rows, total_amt
        FROM {dm}.v_unclassified_top
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
    sql = f"""
        SELECT t.id as bank_txn_id, t.txn_time, t.in_amt, t.counterparty_name,
               if.file_name, if.file_path
        FROM {ods}.bank_txn t
        JOIN raw.ingest_file if ON t.source_file_id = if.id
        ORDER BY t.txn_time DESC
        LIMIT 3
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
  python scripts/run_pipeline_oneclick.py --brand gelatomiiix --month 2026-01
  python scripts/run_pipeline_oneclick.py --brand bonjur
  python scripts/run_pipeline_oneclick.py --brand gelatomiiix --db-url postgresql://user:pass@localhost:5432/db
        """,
    )

    parser.add_argument(
        "--brand",
        choices=["gelatomiiix", "bonjur", "tamkoko", "all"],
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
        default=os.environ.get("DB_PASSWORD"),
        required=not bool(os.environ.get("DB_PASSWORD")),
        help="数据库密码 (required unless DB_PASSWORD env var is set)",
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
    brand_list = list(BRAND_SCHEMAS.keys()) if args.brand == "all" else [args.brand]

    results = {}

    try:
        for idx, brand in enumerate(brand_list, start=1):
            schemas = BRAND_SCHEMAS[brand]

            # Import step
            with pipeline_step(ops, f"run_import_{brand}", step_order=idx * 10 - 9):
                import_script = IMPORT_SCRIPTS.get(brand)
                if import_script and import_script.exists():
                    result_import = run_import(brand, args.dry_run, args.month)
                    print(f"  Import: {result_import.get('status')}")
                else:
                    print(f"  Import: skipped (no script)")

            # Classification pipeline step
            with pipeline_step(ops, f"run_{brand}_pipeline", step_order=idx * 10):
                result = run_brand_pipeline(brand, schemas, conn, args.month, args.dry_run)
                results[brand] = result

        with pipeline_step(ops, "print_summary", step_order=99):
            pass

    except Exception as e:
        error_msg = str(e)
        print(f"ERROR: Pipeline failed: {error_msg}")
        if ops:
            ops.finish(status="failed", note=error_msg[:500])
        raise
    finally:
        if conn:
            conn.close()
        if ops:
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
    print("  # Gelatomiiix 覆盖率")
    print("  SELECT * FROM brand_gelatomiiix_dm.v_coverage_monthly;")
    print("  # Gelatomiiix 未分类 Top 20")
    print("  SELECT * FROM brand_gelatomiiix_dm.v_unclassified_top LIMIT 20;")
    print("  # Bonjur 导入记录")
    print("  SELECT * FROM raw.ingest_file WHERE brand_code = 'bonjur';")
    print("  # Pipeline 运行记录")
    print("  SELECT * FROM ops.pipeline_run ORDER BY started_at DESC LIMIT 10;")
    print("  # Pipeline 步骤记录")
    print("  SELECT * FROM ops.pipeline_step_run ORDER BY started_at DESC LIMIT 20;")


if __name__ == "__main__":
    main()
