#!/usr/bin/env bash
# WDG Data Foundation — 本地"生产一致"模式
#
# 拉一个 ubuntu:24.04 容器, 把项目 mount 到 /opt/wdg, 把 PGDATA mount 到
# /var/lib/postgresql/16, 跑 install_systemd.sh, systemctl start wdg.target.
#
# 目标: 本地 docker 容器内跑真 systemd, 与生产 100% 一致
#       - 端口: 3001 / 4101 / 5432 / 5433 (与生产 systemd unit 一致)
#       - 主机名: localhost (跨 service 用 127.0.0.1)
#       - 日志: journalctl (容器内)
#       - 服务编排: wdg.target 启停, systemctl restart X.service
#
# 用法:
#   ./scripts/dev_systemd.sh up        # 拉起容器 + install + start wdg.target
#   ./scripts/dev_systemd.sh status    # 容器 + 5 个 service 状态
#   ./scripts/dev_systemd.sh shell     # 进容器 shell
#   ./scripts/dev_systemd.sh logs <svc># 容器内 journalctl -u <svc> -f
#   ./scripts/dev_systemd.sh restart <svc>
#   ./scripts/dev_systemd.sh reset     # 删容器 (PGDATA 保留 = host bind mount)
#   ./scripts/dev_systemd.sh clean --yes # 删容器 + 清 PGDATA
#
# ⚠️ 需要 --privileged (systemd / cgroup 要求)
# ⚠️ 端口 3001/4101/5432/5433 必须空闲 (会冲突的 docker compose 必须先 down)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ====== 配置 (与 .env / deploy 一致) ======
CONTAINER_NAME="${CONTAINER_NAME:-wdg-systemd}"
IMAGE="${IMAGE:-ubuntu:24.04}"
HOST_PROJECT_DIR="$PROJECT_DIR"
CONTAINER_PROJECT_DIR="/opt/wdg"
PGDATA_HOST_DIR="$PROJECT_DIR/.pgdata/16/main"
PGDATA_AGENT_HOST_DIR="$PROJECT_DIR/.pgdata/16/agent_main"
ENV_DIR_HOST="$PROJECT_DIR/.etc/wdg"

# 端口 — 与 deploy/systemd/wdg-*.service 严格一致
HOST_PORT_UI="${HOST_PORT_UI:-3001}"
HOST_PORT_AGENT="${HOST_PORT_AGENT:-4101}"
HOST_PORT_WS="${HOST_PORT_WS:-4102}"
HOST_PORT_PG="${HOST_PORT_PG:-5432}"
HOST_PORT_PG_AGENT="${HOST_PORT_PG_AGENT:-5433}"

# 颜色
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
log() { echo "${GREEN}[INFO]${NC} $*"; }
warn(){ echo "${YELLOW}[WARN]${NC} $*"; }
err() { echo "${RED}[ERR]${NC} $*" >&2; }
die() { err "$*"; exit 1; }

check_tools() {
  command -v docker >/dev/null || die "需要 docker"
  docker info >/dev/null 2>&1 || die "Docker 未运行"
}

port_in_use() {
  local p="$1"
  lsof -i ":$p" -sTCP:LISTEN >/dev/null 2>&1
}

check_ports_free() {
  local conflict=0
  for p in "$HOST_PORT_UI" "$HOST_PORT_AGENT" "$HOST_PORT_WS" "$HOST_PORT_PG" "$HOST_PORT_PG_AGENT"; do
    if port_in_use "$p"; then
      err "端口 $p 被占用:"; lsof -i ":$p" -sTCP:LISTEN | tail -n +2
      conflict=1
    fi
  done
  if [ "$conflict" -ne 0 ]; then
    die "请先释放端口 (例: cd .claude/worktrees/agent-first-product && docker compose down)"
  fi
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"
}

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"
}

# 一次性准备 host 上 systemd 需要的目录布局
prepare_host_dirs() {
  mkdir -p "$PGDATA_HOST_DIR" "$PGDATA_AGENT_HOST_DIR" "$ENV_DIR_HOST"
  # macOS bind-mount 时 host uid 是 501, 容器内 uid 是 0 (root) 默认即读写
  # 但 systemd 内 service 用 www-data (uid 33) / postgres (uid 999)
  # 容器内 install_systemd.sh 之后会 chown 这里面的 PGDATA, 不需要在 host 提前改
  chmod 777 "$PGDATA_HOST_DIR" "$PGDATA_AGENT_HOST_DIR" "$ENV_DIR_HOST" "$PROJECT_DIR"
}

# 启动 systemd 容器的长命令 — 写到一个变量便于复用
docker_run_cmd() {
  docker run -d --name "$CONTAINER_NAME" \
    --privileged \
    --pid=host \
    --cgroupns=host \
    -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    -v "$HOST_PROJECT_DIR:$CONTAINER_PROJECT_DIR" \
    -v "$PGDATA_HOST_DIR:/var/lib/postgresql/16/main" \
    -v "$PGDATA_AGENT_HOST_DIR:/var/lib/postgresql/16/agent_main" \
    -v "$ENV_DIR_HOST:/etc/wdg" \
    -p "${HOST_PORT_UI}:3001" \
    -p "${HOST_PORT_AGENT}:4101" \
    -p "${HOST_PORT_WS}:4102" \
    -p "${HOST_PORT_PG}:5432" \
    -p "${HOST_PORT_PG_AGENT}:5433" \
    -e "DB_PORT=$HOST_PORT_PG" \
    -e "UI_PORT=$HOST_PORT_UI" \
    --restart unless-stopped \
    "$IMAGE" /sbin/init
}

# 探测 systemd 启动完成 (systemd PID 1 在容器里)
wait_systemd_ready() {
  log "等容器内 systemd 起来..."
  local i=0
  while [ "$i" -lt 60 ]; do
    if docker exec "$CONTAINER_NAME" systemctl is-system-running >/dev/null 2>&1; then
      local state
      state=$(docker exec "$CONTAINER_NAME" systemctl is-system-running 2>/dev/null || true)
      case "$state" in
        running|degraded) log "systemd 状态: $state"; return 0 ;;
      esac
    fi
    i=$((i+1)); sleep 1
  done
  warn "systemd 未在预期时间内就绪, 状态: $(docker exec "$CONTAINER_NAME" systemctl is-system-running 2>/dev/null || echo unknown)"
  return 1
}

# 容器内一次性安装 systemd unit + 启服务
container_install_and_start() {
  log "容器内 apt 安装 PG/Node/系统依赖..."
  docker exec "$CONTAINER_NAME" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl wget ca-certificates gnupg lsb-release sudo postgresql-16 nodejs npm python3 python3-venv python3-pip >/dev/null
    # postgres 用户加 sudo (systemd unit 跑 npm/postgres 需要)
    echo "postgres ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
    echo "www-data ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
    # www-data 用户不存在时建一个
    id www-data >/dev/null 2>&1 || useradd -m -s /bin/bash www-data
    # postgres 用户 (PG install 时已建)
  '
  log "host 用户 (uid 501) 也建一下, 跟 bind mount 配合"
  docker exec "$CONTAINER_NAME" bash -c '
    id -u ericmr >/dev/null 2>&1 || useradd -u 501 -m -s /bin/bash ericmr
    echo "ericmr ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
  '

  log "绑定 host 端口 (PG_PORT override)"
  docker exec "$CONTAINER_NAME" bash -c "
    echo 'Starting install_systemd.sh...'
    cd $CONTAINER_PROJECT_DIR
    # PGPORT 通过 env 传进去 — 但 install_systemd.sh 默认读 5432, 我们的 bind mount 已经把容器 5432 映射到 host 5432, 一致
    REPO_DIR=$CONTAINER_PROJECT_DIR bash scripts/install_systemd.sh
  "

  log "启动 wdg.target"
  docker exec "$CONTAINER_NAME" systemctl daemon-reload
  docker exec "$CONTAINER_NAME" systemctl enable wdg.target
  docker exec "$CONTAINER_NAME" systemctl start wdg.target

  log "等 systemd 起来, 5 个 service..."
  local i=0
  while [ "$i" -lt 120 ]; do
    local ok=0
    for svc in wdg-postgres.service wdg-postgres-agent.service wdg-ui.service wdg-agent.service wdg-ws-proxy.service; do
      docker exec "$CONTAINER_NAME" systemctl is-active "$svc" >/dev/null 2>&1 && ok=$((ok+1))
    done
    if [ "$ok" -ge 5 ]; then
      log "5 个 service 全部 active"
      return 0
    fi
    i=$((i+1)); sleep 2
  done
  warn "部分 service 未起来, 见下方 status"
  docker exec "$CONTAINER_NAME" systemctl status wdg.target --no-pager || true
  return 1
}

cmd_up() {
  check_tools
  check_ports_free
  prepare_host_dirs

  if container_running; then
    log "容器 $CONTAINER_NAME 已运行"
  elif container_exists; then
    log "启动已存在的容器 $CONTAINER_NAME..."
    docker start "$CONTAINER_NAME" >/dev/null
  else
    log "拉镜像 $IMAGE..."
    docker pull "$IMAGE" >/dev/null
    log "创建并启动 systemd 容器..."
    docker_run_cmd >/dev/null
  fi

  wait_systemd_ready || die "systemd 没起来"

  # 容器目录权限 777 — 让 host uid 501 (你) 也能直接读
  docker exec "$CONTAINER_NAME" bash -c "
    chmod -R 777 $CONTAINER_PROJECT_DIR /var/lib/postgresql/16 /etc/wdg
  "

  # 第一次 up: 装依赖 + 跑 install_systemd.sh
  if ! docker exec "$CONTAINER_NAME" systemctl list-unit-files wdg.target >/dev/null 2>&1; then
    container_install_and_start
  else
    log "wdg.unit 已装, 重启 target"
    docker exec "$CONTAINER_NAME" systemctl restart wdg.target
  fi

  echo
  log "完成。访问入口 (与生产一致):"
  echo "  - UI:    http://localhost:$HOST_PORT_UI"
  echo "  - Agent: http://localhost:$HOST_PORT_AGENT"
  echo "  - PG:    localhost:$HOST_PORT_PG (user/pass 见 /etc/wdg/postgres.env)"
  echo "  - 测试数据库: dataplatform_test"
  echo
  log "诊断命令:"
  echo "  $0 status"
  echo "  $0 logs <wdg-postgres|wdg-postgres-agent|wdg-ui|wdg-agent|wdg-ws-proxy>"
  echo "  $0 shell"
}

cmd_status() {
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | awk -v c="$CONTAINER_NAME" 'NR==1{print;next} $1==c{print}'
  echo
  if container_running; then
    docker exec "$CONTAINER_NAME" systemctl status wdg.target --no-pager 2>&1 | head -40
  fi
}

cmd_shell() {
  [ -n "${1:-}" ] && docker exec -it "$CONTAINER_NAME" bash -c "cd $CONTAINER_PROJECT_DIR && exec $*"
  docker exec -it "$CONTAINER_NAME" bash
}

cmd_logs() {
  local svc="${1:-}"
  [ -z "$svc" ] && die "用法: $0 logs <service-name>"
  docker exec "$CONTAINER_NAME" journalctl -u "$svc" -f --no-pager
}

cmd_restart() {
  local svc="${1:-}"
  [ -z "$svc" ] && die "用法: $0 restart <service-name | wdg.target>"
  docker exec "$CONTAINER_NAME" systemctl restart "$svc"
  docker exec "$CONTAINER_NAME" systemctl status "$svc" --no-pager | head -10
}

cmd_reset() {
  warn "删容器 (PGDATA 在 host, 保留数据)"
  docker rm -f "$CONTAINER_NAME" 2>&1 || true
  log "reset 完成。 下次 up 时 PGDATA 还在 $PGDATA_HOST_DIR"
}

cmd_clean() {
  local yes="${1:-}"
  [ "$yes" = "--yes" ] || die "用法: $0 clean --yes (会删 PGDATA + 容器)"
  warn "删容器 + 清 PGDATA ..."
  docker rm -f "$CONTAINER_NAME" 2>&1 || true
  rm -rf "$PGDATA_HOST_DIR" "$PGDATA_AGENT_HOST_DIR"
  log "clean 完"
}

usage() {
  cat <<EOF
用法: $0 <command>
  up           启动容器 (首次含 install + start wdg.target)
  status       容器 + service 状态
  shell        进容器
  logs <svc>   journalctl -u <svc> -f
  restart <svc>systemctl restart <svc>
  reset        删容器 (PGDATA 保留)
  clean --yes  删容器 + PGDATA
EOF
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    up) cmd_up "$@" ;;
    status) cmd_status "$@" ;;
    shell) cmd_shell "$@" ;;
    logs) cmd_logs "$@" ;;
    restart) cmd_restart "$@" ;;
    reset) cmd_reset "$@" ;;
    clean) cmd_clean "$@" ;;
    -h|--help|help|"") usage ;;
    *) die "未知命令: $cmd (--help)" ;;
  esac
}

main "$@"
