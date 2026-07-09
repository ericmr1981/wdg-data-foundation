#!/usr/bin/env bash
# WDG Data Foundation — 本地开发重启快捷方式
#
# 在 mac 上编辑代码后, 通过 Lima 转发让 VM 内的 systemd 服务重启,
# 模拟生产 deploy 路径(无 auto-pull, 仅本地 restart)。
#
# 用法:
#   ./scripts/dev_restart_ui.sh              # 重启 UI
#   ./scripts/dev_restart_ui.sh all          # 重启 wdg.target (全部 5 个)
#   ./scripts/dev_restart_ui.sh ui agent     # 重启指定服务
#   ./scripts/dev_restart_ui.sh logs ui      # tail UI 日志

set -euo pipefail

VM_NAME="${VM_NAME:-wdg-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 颜色
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
log() { echo "${GREEN}[INFO]${NC} $*"; }
warn(){ echo "${YELLOW}[WARN]${NC} $*"; }
err() { echo "${RED}[ERR]${NC} $*" >&2; }

ensure_vm_running() {
  local status
  status=$(limactl list --json "$VM_NAME" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")
  if [ "$status" != "Running" ]; then
    log "VM $VM_NAME 未运行,启动..."
    limactl start "$VM_NAME"
    # 等 systemd ready
    local i=0
    while [ "$i" -lt 60 ]; do
      if limactl shell "$VM_NAME" -- systemctl is-system-running >/dev/null 2>&1; then
        log "VM ready"
        return 0
      fi
      i=$((i+1)); sleep 1
    done
    err "VM 启动超时"
    exit 1
  fi
}

do_restart() {
  local svc="$1"
  log "重启 wdg-${svc}.service ..."
  limactl shell "$VM_NAME" -- sudo systemctl restart "wdg-${svc}.service"
  log "等 active..."
  local i=0
  while [ "$i" -lt 30 ]; do
    if limactl shell "$VM_NAME" -- systemctl is-active "wdg-${svc}.service" >/dev/null 2>&1; then
      log "wdg-${svc}.service 已 active"
      return 0
    fi
    i=$((i+1)); sleep 1
  done
  warn "wdg-${svc}.service 启动超时,看日志"
  limactl shell "$VM_NAME" -- journalctl -u "wdg-${svc}.service" -n 30 --no-pager
  return 1
}

do_logs() {
  local svc="$1"
  log "tail journalctl -u wdg-${svc}.service -f (Ctrl+C 退出)"
  limactl shell "$VM_NAME" -- sudo journalctl -u "wdg-${svc}.service" -f --no-pager
}

usage() {
  cat <<EOF
用法: $0 [all] [service-name ...] | logs <service>

服务名(简写)        systemd unit
─────────────────────────────────────
ui                  wdg-ui.service
agent               wdg-agent.service
postgres            wdg-postgres.service
postgres-agent      wdg-postgres-agent.service
ws-proxy            wdg-ws-proxy.service
all                 wdg.target (全部 5 个)

示例:
  $0 ui                 # 重启 UI
  $0 ui agent           # 重启 UI + Agent
  $0 all                # 重启 wdg.target
  $0 logs ui            # tail UI 日志
  $0 logs postgres      # tail PG 日志
EOF
}

main() {
  if [ $# -eq 0 ]; then usage; exit 0; fi

  # mac 上的 .env 跟 VM 内 .env 是否一致?
  if [ -f "$PROJECT_DIR/.env" ]; then
    local mac_db_host
    mac_db_host=$(grep "^DB_HOST=" "$PROJECT_DIR/.env" | cut -d= -f2)
    if [ "$mac_db_host" != "127.0.0.1" ]; then
      warn ".env 里的 DB_HOST=$mac_db_host (期望 127.0.0.1)"
      warn "  本地会连错 DB; 部署前请改回生产 IP"
    fi
  fi

  ensure_vm_running

  # logs 子命令
  if [ "${1:-}" = "logs" ]; then
    shift
    [ $# -lt 1 ] && { err "logs 需要 service 名"; usage; exit 1; }
    do_logs "$1"
    return
  fi

  # restart 子命令(默认)
  local services=()
  if [ "${1:-}" = "all" ]; then
    log "重启 wdg.target (全部 5 个服务)"
    limactl shell "$VM_NAME" -- sudo systemctl restart wdg.target
    sleep 5
    limactl shell "$VM_NAME" -- systemctl is-active wdg.target wdg-postgres.service wdg-postgres-agent.service wdg-ui.service wdg-agent.service wdg-ws-proxy.service 2>&1 | sed 's/^/  /'
  else
    for arg in "$@"; do
      services+=("$arg")
    done
    for s in "${services[@]}"; do
      do_restart "$s"
    done
  fi
}

main "$@"
