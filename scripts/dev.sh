#!/usr/bin/env bash
# WDG Data Foundation - 一键开关项目服务（不做初始化）
# 用法:
#   ./scripts/dev.sh up
#   ./scripts/dev.sh down
#   ./scripts/dev.sh restart
#   ./scripts/dev.sh status
#   ./scripts/dev.sh logs [pg|metabase]
#   ./scripts/dev.sh clean --yes   # 危险：删除容器+数据卷（恢复"全新环境"）
#
# 设计原则：
# - 不改变现有运行方式：沿用 dataplatform-pg（Postgres）与 dataplatform-metabase（Metabase）容器命名/端口
# - 只负责"开/关/状态/健康检查"，不执行 init_local_env.sh 的 SQL 初始化逻辑

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 支持 .env（与 init_local_env.sh 一致）
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# ====== 可配置项（默认值与现有脚本保持一致） ======
PG_CONTAINER_NAME="${PG_CONTAINER_NAME:-dataplatform-pg}"
PG_IMAGE="${PG_IMAGE:-postgres:16}"
DB_NAME="${DB_NAME:-dataplatform}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_PORT="${DB_PORT:-5432}"

METABASE_CONTAINER_NAME="${METABASE_CONTAINER_NAME:-dataplatform-metabase}"
METABASE_IMAGE="${METABASE_IMAGE:-metabase/metabase:latest}"
METABASE_PORT="${METABASE_PORT:-8082}"

# ====== 输出样式 ======
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

log_info() { echo "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo "${YELLOW}[WARN]${NC} $*"; }
log_error(){ echo "${RED}[ERROR]${NC} $*"; }

die() { log_error "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1（请先安装/配置）"
}

require_docker() {
  require_cmd docker
  docker info >/dev/null 2>&1 || die "Docker 未运行（请先启动 Docker Desktop/daemon）"
}

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "$1"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$1"
}

wait_for_postgres() {
  local max_attempts="${1:-30}"
  local i=0
  while (( i < max_attempts )); do
    if docker exec "$PG_CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i+1))
    sleep 1
  done
  return 1
}

wait_for_metabase() {
  local max_attempts="${1:-60}"
  local i=0
  while (( i < max_attempts )); do
    # Metabase /api/health 在新老版本表现略有差异，这里只要 HTTP 能通即可
    if curl -fsS "http://localhost:${METABASE_PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    if curl -fsS "http://localhost:${METABASE_PORT}" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i+1))
    sleep 1
  done
  return 1
}

start_postgres() {
  log_info "启动 Postgres（容器：${PG_CONTAINER_NAME}，端口：${DB_PORT}）"

  # 若存在 dashboard compose 的 postgres 容器且占用同端口，提示用户先关掉（避免端口冲突）
  if container_running "dataplatform-pg-dashboard"; then
    if docker port dataplatform-pg-dashboard 5432/tcp 2>/dev/null | grep -q ":${DB_PORT}$"; then
      die "检测到 dataplatform-pg-dashboard 正在运行且占用端口 ${DB_PORT}。请先停止它：docker stop dataplatform-pg-dashboard"
    else
      log_warn "检测到 dataplatform-pg-dashboard 正在运行（端口不冲突），将继续启动 ${PG_CONTAINER_NAME}"
    fi
  fi

  if container_exists "$PG_CONTAINER_NAME"; then
    if container_running "$PG_CONTAINER_NAME"; then
      log_info "Postgres 已在运行"
    else
      docker start "$PG_CONTAINER_NAME" >/dev/null
      log_info "Postgres 已启动"
    fi
  else
    # 保持与 init_local_env.sh 一致：docker run 方式 + 固定端口映射
    # 与 scripts/init_local_env.sh 保持一致：不显式指定 volume 名称（避免改变现有运行方式/卷命名）
    docker run -d --name "$PG_CONTAINER_NAME" \
      -e POSTGRES_DB="$DB_NAME" \
      -e POSTGRES_USER="$DB_USER" \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -p "${DB_PORT}:5432" \
      "$PG_IMAGE" >/dev/null
    log_info "Postgres 容器已创建并启动"
  fi

  if wait_for_postgres 30; then
    log_info "Postgres 健康检查通过"
  else
    log_warn "Postgres 未在预期时间内就绪；可查看日志：docker logs -n 200 ${PG_CONTAINER_NAME}"
  fi
}

start_metabase() {
  log_info "启动 Metabase（容器：${METABASE_CONTAINER_NAME}，端口：${METABASE_PORT}）"

  require_cmd curl

  if container_exists "$METABASE_CONTAINER_NAME"; then
    if container_running "$METABASE_CONTAINER_NAME"; then
      log_info "Metabase 已在运行"
    else
      docker start "$METABASE_CONTAINER_NAME" >/dev/null
      log_info "Metabase 已启动"
    fi
  else
    # 兼容既有命名（当前环境常见为 dataplatform_metabase_data）
    docker run -d --name "$METABASE_CONTAINER_NAME" \
      -p "${METABASE_PORT}:3000" \
      -e MB_DB_TYPE=h2 \
      -e MB_DB_FILE=/metabase-data/metabase.db \
      -e JAVA_TIMEZONE=Asia/Shanghai \
      -v dataplatform_metabase_data:/metabase-data \
      "$METABASE_IMAGE" >/dev/null
    log_info "Metabase 容器已创建并启动"
  fi

  if wait_for_metabase 60; then
    log_info "Metabase 健康检查通过： http://localhost:${METABASE_PORT}"
  else
    log_warn "Metabase 未在预期时间内就绪；可查看日志：docker logs -n 200 ${METABASE_CONTAINER_NAME}"
  fi
}

cmd_up() {
  require_docker
  start_postgres
  start_metabase

  echo
  log_info "完成。常用入口："
  echo "- Postgres: localhost:${DB_PORT}（容器：${PG_CONTAINER_NAME}）"
  echo "- Metabase: http://localhost:${METABASE_PORT}（容器：${METABASE_CONTAINER_NAME}）"
  echo "- 初始化（如需）：./scripts/init_local_env.sh"
}

cmd_down() {
  require_docker

  if container_running "$METABASE_CONTAINER_NAME"; then
    docker stop "$METABASE_CONTAINER_NAME" >/dev/null
    log_info "已停止 Metabase"
  else
    log_info "Metabase 未运行"
  fi

  if container_running "$PG_CONTAINER_NAME"; then
    docker stop "$PG_CONTAINER_NAME" >/dev/null
    log_info "已停止 Postgres"
  else
    log_info "Postgres 未运行"
  fi
}

cmd_restart() {
  cmd_down
  cmd_up
}

cmd_status() {
  require_docker
  echo "Containers:";
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | awk -v a="${PG_CONTAINER_NAME}" -v b="${METABASE_CONTAINER_NAME}" -v c="dataplatform-pg-dashboard" 'NR==1{print;next} ($1==a||$1==b||$1==c){print}'
  echo
  echo "Volumes (attached):";
  # 展示当前两个容器实际挂载的数据卷（不猜名字，避免与历史运行方式冲突）
  for c in "$PG_CONTAINER_NAME" "$METABASE_CONTAINER_NAME"; do
    if container_exists "$c"; then
      echo "- $c:";
      docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}{{end}}' "$c" | sed 's/^/    /' || true
    fi
  done
}

cmd_logs() {
  require_docker
  local which="${1:-}"
  case "$which" in
    pg|postgres) docker logs -f "$PG_CONTAINER_NAME" ;;
    metabase|mb) docker logs -f "$METABASE_CONTAINER_NAME" ;;
    "")
      echo "用法：./scripts/dev.sh logs [pg|metabase]";
      exit 1
      ;;
    *)
      die "未知 logs 目标：$which（支持 pg|metabase）"
      ;;
  esac
}

cmd_reset() {
  require_docker
  log_warn "重置容器（不删数据卷，保留数据库内容）..."

  # 只删容器，不删 volume（数据保留）
  if container_running "$METABASE_CONTAINER_NAME"; then
    docker stop "$METABASE_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if container_running "$PG_CONTAINER_NAME"; then
    docker stop "$PG_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  docker rm -f "$METABASE_CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm -f "$PG_CONTAINER_NAME" >/dev/null 2>&1 || true

  log_info "reset 完成（数据卷未动，规则/数据保留）"
  log_info "下次 up 时会复用现有数据卷"
}

cmd_clean() {
  require_docker
  local yes="${1:-}"
  if [[ "$yes" != "--yes" ]]; then
    cat <<EOF
${YELLOW}clean 是"恢复全新环境"的危险操作，会删除：${NC}
- 容器：${PG_CONTAINER_NAME}, ${METABASE_CONTAINER_NAME}
- 数据卷：所有挂载的 volume（会丢全部数据）

如果你确定要执行：
  ./scripts/dev.sh clean --yes
EOF
    exit 1
  fi

  log_warn "删除容器（如存在，包含其匿名卷）..."
  docker rm -fv "$METABASE_CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm -fv "$PG_CONTAINER_NAME" >/dev/null 2>&1 || true

  # 尝试删除常见的命名卷（如果存在）
  log_warn "删除命名数据卷（如存在）..."
  docker volume rm dataplatform_metabase_data >/dev/null 2>&1 || true
  docker volume rm metabase_data >/dev/null 2>&1 || true
  docker volume rm dataplatform_pg_data >/dev/null 2>&1 || true

  log_info "clean 完成"
}

cmd_prune_data() {
  require_docker
  local yes="${1:-}"

  if [[ "$yes" != "--yes" ]]; then
    cat <<EOF
${YELLOW}prune-data 是"清理原始导入数据"的操作，会 TRUNCATE：${NC}
- yufeng_ods.bank_txn（银行流水原始数据）
- bonjur_ods.sales_daily（营业日报原始数据）
- raw.ingest_file（文件登记记录）
- ops.pipeline_run / ops.pipeline_step_run（运行记录）

保留（不动）：
- yufeng_cfg.* / bonjur_cfg.*（规则/字典/门店维表）
- yufeng_dm.bank_txn_override（人工匹配记录）
- yufeng_dm.bank_rule_map（规则表）
- Metabase 配置

如果你确定要执行：
  ./scripts/dev.sh prune-data --yes
EOF
    exit 1
  fi

  log_warn "清理原始导入数据（ODS 层）..."

  docker exec -i "$PG_CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" <<EOF
-- Yufeng ODS
TRUNCATE TABLE yufeng_ods.bank_txn CASCADE;

-- Bonjur ODS（如果存在）
TRUNCATE TABLE bonjur_ods.sales_daily CASCADE;

-- RAW 层
TRUNCATE TABLE raw.ingest_file CASCADE;

-- OPS 层
TRUNCATE TABLE ops.pipeline_step_run CASCADE;
TRUNCATE TABLE ops.pipeline_run CASCADE;

SELECT 'ODS data pruned successfully' as result;
EOF

  log_info "prune-data 完成（规则/配置/DM 视图保留）"
  log_info "DM 视图现在会显示空数据（因为 ODS 已清空）"
}

usage() {
  cat <<EOF
用法：
  ./scripts/dev.sh up          # 启动所有服务（Postgres + Metabase）+ 健康检查
  ./scripts/dev.sh down        # 停止服务（保留数据）
  ./scripts/dev.sh restart     # 重启
  ./scripts/dev.sh status      # 查看状态
  ./scripts/dev.sh logs [pg|metabase]  # 查看日志
  ./scripts/dev.sh reset       # 重置容器（不删数据卷，保留规则/数据）
  ./scripts/dev.sh prune-data --yes    # 清理原始数据（ODS 层，保留规则/配置）
  ./scripts/dev.sh clean --yes # 彻底清理（删容器 + 数据卷，会丢全部数据）
EOF
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    up) cmd_up "$@" ;;
    down) cmd_down "$@" ;;
    restart) cmd_restart "$@" ;;
    status) cmd_status "$@" ;;
    logs) cmd_logs "$@" ;;
    reset) cmd_reset "$@" ;;
    prune-data) cmd_prune_data "$@" ;;
    clean) cmd_clean "$@" ;;
    -h|--help|help|"") usage ;;
    *) die "未知命令：$cmd（用 --help 查看）" ;;
  esac
}

main "$@"
