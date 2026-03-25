#!/bin/bash
#
# WDG Data Foundation 一键本地初始化脚本
# 用法:
#   ./scripts/init_local_env.sh [--with-sample-data]
#
# 可选环境变量覆盖：
#   CONTAINER_NAME=dataplatform-pg-wdgtest DB_PORT=55432 ./scripts/init_local_env.sh --with-sample-data
#
# 约束：尽量幂等；并且对 SQL 执行开启 ON_ERROR_STOP（避免“看似成功但实际有报错”）

set -euo pipefail

# ========== 配置 ==========
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Docker 配置（允许环境变量覆盖）
CONTAINER_NAME="${CONTAINER_NAME:-dataplatform-pg}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16}"
POSTGRES_DB="${POSTGRES_DB:-dataplatform}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

# 环境变量（支持 .env 文件）
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# DB 连接默认值（脚本/导入/pipe 都用这个）
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-$POSTGRES_DB}"
DB_USER="${DB_USER:-$POSTGRES_USER}"
DB_PASSWORD="${DB_PASSWORD:-$POSTGRES_PASSWORD}"

# 容器端口映射用 DB_PORT（方便一处控制）
POSTGRES_PORT="$DB_PORT"

# 样例数据开关
WITH_SAMPLE_DATA=false
if [[ "${1:-}" == "--with-sample-data" ]]; then
  WITH_SAMPLE_DATA=true
fi

# ========== 颜色输出 ==========
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

psql_in_docker() {
  docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

# ========== 函数定义 ==========
check_docker() {
  if ! command -v docker &> /dev/null; then
    log_error "Docker 未安装，请先安装 Docker。"
    exit 1
  fi
  if ! docker info &> /dev/null; then
    log_error "Docker 未运行，请先启动 Docker。"
    exit 1
  fi
  log_info "Docker 运行正常"
}

setup_postgres() {
  log_info "检查 PostgreSQL 容器（$CONTAINER_NAME）..."

  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      log_info "容器 $CONTAINER_NAME 已在运行"
    else
      log_info "启动已停止的容器 $CONTAINER_NAME..."
      docker start "$CONTAINER_NAME" >/dev/null
      sleep 2
    fi
  else
    log_info "创建并启动 PostgreSQL 容器..."
    docker run -d --name "$CONTAINER_NAME" \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -p "${POSTGRES_PORT}:5432" \
      "$POSTGRES_IMAGE" >/dev/null

    log_info "等待 PostgreSQL 启动..."
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
      if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &> /dev/null; then
        log_info "PostgreSQL 已就绪"
        return 0
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    log_error "PostgreSQL 启动超时"
    exit 1
  fi
}

wait_for_db() {
  log_info "等待数据库连接..."
  local max_attempts=30
  local attempt=0
  while [ $attempt -lt $max_attempts ]; do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &> /dev/null; then
      log_info "数据库连接成功"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  log_error "无法连接到数据库"
  exit 1
}

execute_sql_file() {
  local sql_file="$1"
  local description="${2:-执行 SQL}"

  if [ ! -f "$sql_file" ]; then
    log_warn "SQL 文件不存在: $sql_file，跳过"
    return 0
  fi

  log_info "$description: $sql_file"
  psql_in_docker < "$sql_file"
}

create_schemas() {
  log_info "创建 schema..."

  psql_in_docker <<'EOF'
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE SCHEMA IF NOT EXISTS bonjur_cfg;
CREATE SCHEMA IF NOT EXISTS bonjur_dm;

CREATE SCHEMA IF NOT EXISTS yufeng_ods;
CREATE SCHEMA IF NOT EXISTS yufeng_cfg;
CREATE SCHEMA IF NOT EXISTS yufeng_dm;

SELECT 'Schemas created successfully' as result;
EOF

  log_info "Schema 创建完成"
}

create_bonjur_compat_view() {
  log_info "创建 Bonjur 兼容视图 bonjur_ods.sales_daily..."

  psql_in_docker <<'EOF'
DROP VIEW IF EXISTS bonjur_ods.sales_daily;

CREATE VIEW bonjur_ods.sales_daily AS
SELECT
    store_code,
    month,
    gross_sales_amt,
    discount_amt,
    revenue_amt,
    order_cnt,
    refund_amt,
    source_file_id,
    created_at
FROM bonjur_ods.sales_monthly;

SELECT 'View bonjur_ods.sales_daily created/updated' as result;
EOF
}

install_python_deps() {
  log_info "检查/安装 Python 依赖..."

  # 统一用项目内 venv，避免 macOS PEP 668 限制
  if [ ! -f "$PROJECT_DIR/.venv/bin/python" ]; then
    log_info "创建项目虚拟环境 .venv..."
    python3 -m venv "$PROJECT_DIR/.venv"
  fi

  local PYTHON="$PROJECT_DIR/.venv/bin/python"

  "$PYTHON" -m pip install -U pip -q || true

  if [ -f "$PROJECT_DIR/requirements.txt" ]; then
    log_info "安装 requirements.txt..."
    "$PYTHON" -m pip install -r "$PROJECT_DIR/requirements.txt" -q
  else
    log_warn "requirements.txt 不存在，安装最小依赖集合"
    "$PYTHON" -m pip install psycopg2-binary pandas openpyxl -q
  fi

  log_info "Python 依赖 OK"
}

import_sample_data() {
  log_info "===== 开始导入样例数据 ====="

  local PYTHON="$PROJECT_DIR/.venv/bin/python"

  local yufeng_sample="$PROJECT_DIR/inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx"
  local bonjur_sample="$PROJECT_DIR/inputs/bonjur/wz_oh_wxc/sales/2026-02/mock_营业数据_自助营业取数_2026-02.csv"

  if [ -f "$yufeng_sample" ]; then
    log_info "导入 Yufeng 银行流水样例..."
    "$PYTHON" "$PROJECT_DIR/scripts/import_yufeng_bank_txn.py" "$yufeng_sample"
  else
    log_warn "Yufeng 样例文件不存在: $yufeng_sample"
  fi

  if [ -f "$bonjur_sample" ]; then
    log_info "导入 Bonjur 营业数据样例..."
    "$PYTHON" "$PROJECT_DIR/scripts/import_bonjur_sales_daily.py" "$bonjur_sample"
  else
    log_warn "Bonjur 样例文件不存在: $bonjur_sample"
  fi

  log_info "运行 pipeline..."
  "$PYTHON" "$PROJECT_DIR/scripts/run_pipeline_oneclick.py" --brand all
}

main() {
  echo "=========================================="
  echo "  WDG Data Foundation 本地环境一键初始化"
  echo "=========================================="
  echo ""

  check_docker
  setup_postgres
  wait_for_db
  create_schemas

  log_info "===== 执行 SQL 文件 ====="

  execute_sql_file "$PROJECT_DIR/ops/OPS_DDL.sql" "创建 ops 表"
  execute_sql_file "$PROJECT_DIR/sql/raw_ingest_file.sql" "创建 raw.ingest_file 表"

  execute_sql_file "$PROJECT_DIR/brand-docs/Yufeng_ODS_DDL.sql" "创建 yufeng_ods 表"
  execute_sql_file "$PROJECT_DIR/brand-docs/Bonjur_ODS_DDL.sql" "创建 bonjur_ods 表"

  execute_sql_file "$PROJECT_DIR/brand-docs/Yufeng_CFG_DDL.sql" "创建 yufeng_cfg.bank_rule_map（code 口径）"
  execute_sql_file "$PROJECT_DIR/sql/bonjur_cfg_ddl.sql" "创建 bonjur_cfg.bank_rule_map（code 口径）"

  # 分类字典（共享给 Bonjur / Yufeng）
  execute_sql_file "$PROJECT_DIR/sql/yufeng_category_dictionary_v1_1.sql" "创建分类字典表 v1.1（共享）"

  # 规则历史（A2）
  execute_sql_file "$PROJECT_DIR/sql/rules_history.sql" "安装规则 history triggers"

  # 分类函数 + 兼容视图（v_bank_txn_classified / v_bank_txn_classified_v2）
  execute_sql_file "$PROJECT_DIR/sql/yufeng_apply_classification.sql" "Yufeng：应用分类（v2）"
  execute_sql_file "$PROJECT_DIR/sql/bonjur_apply_classification.sql" "Bonjur：应用分类（v2）"

  # 覆盖率/未分类
  execute_sql_file "$PROJECT_DIR/sql/yufeng_coverage_and_unclassified.sql" "Yufeng：覆盖率/未分类"
  execute_sql_file "$PROJECT_DIR/sql/yufeng_coverage_by_file.sql" "Yufeng：按文件覆盖率"
  execute_sql_file "$PROJECT_DIR/sql/bonjur_coverage_and_unclassified.sql" "Bonjur：覆盖率/未分类"
  execute_sql_file "$PROJECT_DIR/sql/bonjur_coverage_by_file.sql" "Bonjur：按文件覆盖率"

  # 门店维表
  execute_sql_file "$PROJECT_DIR/sql/yufeng_dim_store.sql" "Yufeng：门店维表"
  execute_sql_file "$PROJECT_DIR/sql/bonjur_dim_store.sql" "Bonjur：门店维表"

  # DM 模型
  execute_sql_file "$PROJECT_DIR/sql/yufeng_dm_models.sql" "Yufeng：DM 模型"
  execute_sql_file "$PROJECT_DIR/sql/bonjur_dm_models.sql" "Bonjur：DM 模型"

  create_bonjur_compat_view

  log_info "===== 验证安装 ====="
  psql_in_docker <<'EOF'
SELECT
  'Schemas' as category,
  schema_name as name
FROM information_schema.schemata
WHERE schema_name IN ('raw','ops','bonjur_ods','bonjur_cfg','bonjur_dm','yufeng_ods','yufeng_cfg','yufeng_dm')
ORDER BY schema_name;
EOF

  install_python_deps

  if [ "$WITH_SAMPLE_DATA" = true ]; then
    import_sample_data
  fi

  echo ""
  echo "=========================================="
  log_info "初始化完成！"
  echo "=========================================="
  echo ""
  echo "后续步骤："
  echo "  export DB_HOST=$DB_HOST"
  echo "  export DB_PORT=$DB_PORT"
  echo "  export DB_NAME=$DB_NAME"
  echo "  export DB_USER=$DB_USER"
  echo "  export DB_PASSWORD=$DB_PASSWORD"
  echo ""
  echo "  docker exec -it $CONTAINER_NAME psql -U $POSTGRES_USER -d $POSTGRES_DB"
  echo ""
  echo "  cat docs/ACCEPTANCE_RUNBOOK.md"
  echo ""
}

main "$@"
