#!/bin/bash
#
# WDG Data Foundation 一键本地初始化脚本
# 用法: ./scripts/init_local_env.sh [--with-sample-data]
#
# 功能:
#   1. 启动/检查 Docker PG（如已存在 dataplatform-pg 则复用）
#   2. 创建必要 schema（raw/ops/yufeng_ods/yufeng_cfg/yufeng_dm/bonjur_ods）
#   3. 依次执行 SQL 文件
#   4. 可选：执行样例导入 + pipeline
#
# 约束: 幂等执行，重复运行不报错

set -e

# ========== 配置 ==========
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Docker 配置
CONTAINER_NAME="dataplatform-pg"
POSTGRES_IMAGE="postgres:16"
POSTGRES_DB="dataplatform"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgres"
POSTGRES_PORT="${DB_PORT:-5432}"

# 环境变量（支持 .env 文件）
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

# 默认值
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-dataplatform}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

# 样例数据开关
WITH_SAMPLE_DATA=false
if [[ "$1" == "--with-sample-data" ]]; then
    WITH_SAMPLE_DATA=true
fi

# ========== 颜色输出 ==========
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ========== 函数定义 ==========

# 检查命令是否存在
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "命令 '$1' 未安装，请先安装。"
        exit 1
    fi
}

# 检查 Docker 是否运行
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

# 启动/检查 PostgreSQL 容器
setup_postgres() {
    log_info "检查 PostgreSQL 容器..."

    # 检查容器是否已存在
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        # 容器已存在，检查状态
        if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
            log_info "容器 $CONTAINER_NAME 已在运行"
        else
            log_info "启动已停止的容器 $CONTAINER_NAME..."
            docker start "$CONTAINER_NAME"
            sleep 3
        fi
    else
        log_info "创建并启动 PostgreSQL 容器..."
        docker run -d --name "$CONTAINER_NAME" \
            -e POSTGRES_DB="$POSTGRES_DB" \
            -e POSTGRES_USER="$POSTGRES_USER" \
            -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            -p "${POSTGRES_PORT}:5432" \
            "$POSTGRES_IMAGE"

        # 等待 PostgreSQL 就绪
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

# 检查数据库连接
wait_for_db() {
    log_info "等待数据库连接..."

    # 尝试使用 psql 或 docker exec
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

# 执行 SQL 文件
# 说明：SQL 文件已使用 IF NOT EXISTS / CREATE OR REPLACE 等幂等语句
# 本函数执行 fail-fast，任何 SQL 错误都会终止脚本（确保问题及时发现）
execute_sql_file() {
    local sql_file="$1"
    local description="${2:-执行 SQL}"

    if [ ! -f "$sql_file" ]; then
        log_warn "SQL 文件不存在: $sql_file，跳过"
        return 0
    fi

    log_info "$description: $sql_file"
    if ! docker exec -i "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$sql_file"; then
        log_error "SQL 执行失败: $sql_file"
        return 1
    fi
}

# 创建 schema
create_schemas() {
    log_info "创建 schema..."

    docker exec -i "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
-- 通用层
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS ops;

-- Bonjur 品牌层
CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE SCHEMA IF NOT EXISTS bonjur_cfg;
CREATE SCHEMA IF NOT EXISTS bonjur_dm;

-- Yufeng 品牌层
CREATE SCHEMA IF NOT EXISTS yufeng_ods;
CREATE SCHEMA IF NOT EXISTS yufeng_cfg;
CREATE SCHEMA IF NOT EXISTS yufeng_dm;

-- Bonjur 兼容视图 schema
CREATE SCHEMA IF NOT EXISTS bonjur_ods;

SELECT 'Schemas created successfully' as result;
EOF

    log_info "Schema 创建完成"
}

# 创建 Bonjur 兼容视图
create_bonjur_compat_view() {
    log_info "创建 Bonjur 兼容视图 bonjur_ods.sales_daily..."

    docker exec -i "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'EOF'
-- 先删除已存在的视图（解决 "cannot drop columns from view" 问题）
DROP VIEW IF EXISTS bonjur_ods.sales_daily;

-- 创建 bonjur_ods.sales_daily 视图，兼容 sales_monthly
-- 用于 API/查询兼容
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

# 安装 Python 依赖
install_python_deps() {
    log_info "检查 Python 依赖..."

    # 查找 Python
    if [ -f "$PROJECT_DIR/.venv/bin/python" ]; then
        PYTHON="$PROJECT_DIR/.venv/bin/python"
    elif command -v python3 &> /dev/null; then
        PYTHON="python3"
    elif command -v python &> /dev/null; then
        PYTHON="python"
    else
        log_warn "未找到 Python，跳过依赖检查"
        return 0
    fi

    log_info "使用 Python: $PYTHON"

    # 检查 psycopg2
    if ! "$PYTHON" -c "import psycopg2" 2>/dev/null; then
        log_info "安装 psycopg2-binary..."
        "$PYTHON" -m pip install psycopg2-binary -q
    else
        log_info "psycopg2 已安装"
    fi
}

# 导入样例数据
import_sample_data() {
    log_info "===== 开始导入样例数据 ====="

    local PYTHON
    if [ -f "$PROJECT_DIR/.venv/bin/python" ]; then
        PYTHON="$PROJECT_DIR/.venv/bin/python"
    else
        PYTHON="python3"
    fi

    # 检查样例数据文件
    local yufeng_sample="$PROJECT_DIR/inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx"
    local bonjur_sample="$PROJECT_DIR/inputs/bonjur/wz_oh_wxc/sales/2026-02/mock_营业数据_自助营业取数_2026-02.csv"

    # Yufeng 导入
    if [ -f "$yufeng_sample" ]; then
        log_info "导入 Yufeng 银行流水样例..."
        "$PYTHON" "$PROJECT_DIR/scripts/import_yufeng_bank_txn.py" "$yufeng_sample" || log_warn "Yufeng 导入可能失败，请检查"
    else
        log_warn "Yufeng 样例文件不存在: $yufeng_sample"
    fi

    # Bonjur 导入
    if [ -f "$bonjur_sample" ]; then
        log_info "导入 Bonjur 营业数据样例..."
        "$PYTHON" "$PROJECT_DIR/scripts/import_bonjur_sales_daily.py" "$bonjur_sample" || log_warn "Bonjur 导入可能失败，请检查"
    else
        log_warn "Bonjur 样例文件不存在: $bonjur_sample"
    fi

    # 运行 pipeline
    log_info "运行 pipeline..."
    "$PYTHON" "$PROJECT_DIR/scripts/run_pipeline_oneclick.py" --brand all || log_warn "Pipeline 运行可能失败，请检查"
}

# ========== 主流程 ==========

main() {
    echo "=========================================="
    echo "  WDG Data Foundation 本地环境一键初始化"
    echo "=========================================="
    echo ""

    # 前置检查
    check_docker

    # 1. 启动/检查 PostgreSQL
    setup_postgres
    wait_for_db

    # 2. 创建 schema
    create_schemas

    # 3. 执行 SQL 文件（按顺序）
    log_info "===== 执行 SQL 文件 ====="

    # 3.1 OPS DDL
    execute_sql_file "$PROJECT_DIR/ops/OPS_DDL.sql" "创建 ops 表"

    # 3.2 RAW ingest_file
    execute_sql_file "$PROJECT_DIR/sql/raw_ingest_file.sql" "创建 raw.ingest_file 表"

    # 3.3 Yufeng ODS (品牌特定)
    execute_sql_file "$PROJECT_DIR/brand-docs/Yufeng_ODS_DDL.sql" "创建 yufeng_ods 表"

    # 3.4 Yufeng CFG (品牌特定)
    execute_sql_file "$PROJECT_DIR/brand-docs/Yufeng_CFG_DDL.sql" "创建 yufeng_cfg 表"

    # 3.5 Bonjur ODS (品牌特定)
    execute_sql_file "$PROJECT_DIR/brand-docs/Bonjur_ODS_DDL.sql" "创建 bonjur_ods 表"

    # 3.5.1 Bonjur CFG（先建表，后续可从 yufeng 复制规则）
    execute_sql_file "$PROJECT_DIR/sql/bonjur_cfg_ddl.sql" "创建 bonjur_cfg.bank_rule_map"

    # 3.6 Yufeng 分类规则与应用
    execute_sql_file "$PROJECT_DIR/sql/yufeng_apply_classification.sql" "应用分类规则"

    # 3.7 Yufeng DM DDL (额外视图)
    # 注意：该文件会 DROP/重建分类函数，并可能 CASCADE 掉依赖视图；因此必须放在 coverage/dm_models 之前
    execute_sql_file "$PROJECT_DIR/brand-docs/Yufeng_DM_DDL_override_and_classified.sql" "创建 DM 额外视图"

    # 3.8 Yufeng 覆盖率与未分类视图
    execute_sql_file "$PROJECT_DIR/sql/yufeng_coverage_and_unclassified.sql" "创建覆盖率视图"

    # 3.8.1 Yufeng 按文件维度覆盖率（T8.5）
    execute_sql_file "$PROJECT_DIR/sql/yufeng_coverage_by_file.sql" "创建按文件维度覆盖率视图"

    # 3.9 Yufeng 门店维表（用于筛选下拉显示门店名）
    execute_sql_file "$PROJECT_DIR/sql/yufeng_dim_store.sql" "创建 Yufeng 门店维表"

    # 3.9.1 Yufeng DM 模型
    execute_sql_file "$PROJECT_DIR/sql/yufeng_dm_models.sql" "创建 Yufeng DM 模型"
    execute_sql_file "$PROJECT_DIR/sql/bonjur_dm_models.sql" "创建 Bonjur DM 模型"

    # 3.9.1 Bonjur 分类 + 覆盖率 + 未分类（对齐 Yufeng 能力）
    # 说明：按需求放在 bonjur_dm_models.sql 之后接入执行顺序
    execute_sql_file "$PROJECT_DIR/sql/bonjur_apply_classification.sql" "Bonjur 应用分类规则"
    execute_sql_file "$PROJECT_DIR/sql/bonjur_coverage_and_unclassified.sql" "Bonjur 覆盖率与未分类视图"
    execute_sql_file "$PROJECT_DIR/sql/bonjur_coverage_by_file.sql" "Bonjur 按文件维度覆盖率视图"

    # 3.10 Yufeng 回归测试
    execute_sql_file "$PROJECT_DIR/sql/yufeng_rule_regression.sql" "创建回归测试视图"

    # 4. 创建 Bonjur 兼容视图
    create_bonjur_compat_view

    # 5. 验证安装
    log_info "===== 验证安装 ====="
    docker exec -i "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'EOF'
SELECT
    'Schemas' as category,
    schema_name as name
FROM information_schema.schemata
WHERE schema_name IN ('raw', 'ops', 'bonjur_ods', 'bonjur_cfg', 'bonjur_dm', 'yufeng_ods', 'yufeng_cfg', 'yufeng_dm')
ORDER BY schema_name;
EOF

    # 6. 安装 Python 依赖
    install_python_deps

    # 7. 导入样例数据（可选）
    if [ "$WITH_SAMPLE_DATA" = true ]; then
        import_sample_data
    fi

    echo ""
    echo "=========================================="
    log_info "初始化完成！"
    echo "=========================================="
    echo ""
    echo "后续步骤："
    echo "  1. 设置环境变量："
    echo "     export DB_HOST=localhost"
    echo "     export DB_PORT=$POSTGRES_PORT"
    echo "     export DB_NAME=$POSTGRES_DB"
    echo "     export DB_USER=$POSTGRES_USER"
    echo "     export DB_PASSWORD=$POSTGRES_PASSWORD"
    echo ""
    echo "  2. 验证数据库："
    echo "     docker exec -it $CONTAINER_NAME psql -U $POSTGRES_USER -d $POSTGRES_DB"
    echo ""
    echo "  3. 导入样例数据（如需要）："
    echo "     $0 --with-sample-data"
    echo ""
    echo "  4. 查看验收手册："
    echo "     cat docs/ACCEPTANCE_RUNBOOK.md"
    echo ""
}

main "$@"
