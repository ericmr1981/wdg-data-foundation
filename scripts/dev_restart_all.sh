#!/bin/bash
# scripts/dev_restart_all.sh
# 一键重启 WDG 全部开发服务 + 启动后验证
#
# 架构:
#   Lima VM (wdg-dev) 跑: agent(4101) + scheduler + postgres(5432/5433)
#   macOS launchd 跑:    UI (3001, next dev)
#
# 用法:
#   bash scripts/dev_restart_all.sh              # 重启全部 + 验证
#   bash scripts/dev_restart_all.sh --agent-only # 只看 agent
#   bash scripts/dev_restart_all.sh --ui-only    # 只看 UI
#   bash scripts/dev_restart_all.sh --verify-only # 只验证，不重启

set -euo pipefail

LIMA_SSH="ssh -o ConnectTimeout=5 -F $HOME/.lima/wdg-dev/ssh.config lima-wdg-dev"
AGENT_DIR="$HOME/Documents/GitHub/wdg-data-foundation/agent"
UI_PLIST="$HOME/Library/LaunchAgents/com.wdg.tamkoko-dev.plist"
LOG_DIR="/tmp/wdg-dev-logs"
mkdir -p "$LOG_DIR"

MODE="${1:-all}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

# ──────────────────────────────────────────────
# 通用 helpers
# ──────────────────────────────────────────────

# check_endpoint <url> <label> <max_retries> <sleep_sec> [optional grep pattern]
# 轮询 HTTP endpoint 直到返回 200（或含指定 pattern），超时返回 1
check_endpoint() {
  local url="$1" label="$2" max_retries="${3:-20}" sleep_sec="${4:-2}" pattern="${5:-}"
  for i in $(seq 1 "$max_retries"); do
    if [ -n "$pattern" ]; then
      if curl -s --max-time 5 "$url" 2>/dev/null | grep -q "$pattern"; then
        green "  ✅ $label ($(curl -s --max-time 3 "$url" 2>/dev/null | tr -d '\n'))"
        return 0
      fi
    else
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
      if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ] 2>/dev/null; then
        green "  ✅ $label (HTTP $code)"
        return 0
      fi
    fi
    sleep "$sleep_sec"
  done
  red "  ❌ $label — 超时 (${max_retries}x${sleep_sec}s)"
  return 1
}

# check_endpoint_hdr <url> <label> <header> <max_retries> <sleep_sec> <grep_pattern>
# 同 check_endpoint，但带自定义 HTTP header（用于 admin 鉴权等场景）
check_endpoint_hdr() {
  local url="$1" label="$2" header="$3" max_retries="${4:-20}" sleep_sec="${5:-2}" pattern="${6:-}"
  for i in $(seq 1 "$max_retries"); do
    if [ -n "$pattern" ]; then
      if curl -s --max-time 5 -H "$header" "$url" 2>/dev/null | grep -q "$pattern"; then
        green "  ✅ $label (pattern matched: $pattern)"
        return 0
      fi
    else
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "$header" "$url" 2>/dev/null || echo "000")
      if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ] 2>/dev/null; then
        green "  ✅ $label (HTTP $code)"
        return 0
      fi
    fi
    sleep "$sleep_sec"
  done
  red "  ❌ $label — 超时 (${max_retries}x${sleep_sec}s)"
  return 1
}

# check_service <service_name> <label>
# 检查 Lima VM 内 systemd 服务是否 active running
check_service() {
  local svc="$1" label="$2"
  local state
  state=$($LIMA_SSH "systemctl is-active '$svc' 2>/dev/null" 2>/dev/null || echo "unknown")
  if [ "$state" = "active" ]; then
    green "  ✅ $label ($svc)"
    return 0
  else
    red "  ❌ $label ($svc) — state=$state"
    return 1
  fi
}

# ──────────────────────────────────────────────
# Lima VM 侧
# ──────────────────────────────────────────────

restart_lima_agent() {
  blue "[agent] 重新编译 Lima VM agent ..."
  $LIMA_SSH "cd /opt/wdg/agent && npm run build 2>&1" || {
    red "[agent] BUILD FAILED — 检查 agent 代码"
    return 1
  }

  blue "[agent] 重启 wdg-agent ..."
  $LIMA_SSH "sudo systemctl restart wdg-agent" || {
    red "[agent] systemctl restart 失败"
    return 1
  }

  # 等 agent 端口上线
  green "[agent] 等待 agent 就绪 ..."
  if check_endpoint "http://localhost:4101/health" "agent :4101/health" 15 2 '"ok"'; then
    return 0
  else
    echo ""
    red "[agent] 诊断信息:"
    $LIMA_SSH "sudo journalctl -u wdg-agent --no-pager -n 15" 2>/dev/null || true
    return 1
  fi
}

restart_lima_scheduler() {
  blue "[scheduler] 重启 wdg-scheduler ..."
  $LIMA_SSH "sudo systemctl restart wdg-scheduler" || {
    red "[scheduler] 重启失败"
    return 1
  }
  sleep 2
  if check_service "wdg-scheduler" "scheduler"; then
    return 0
  else
    $LIMA_SSH "systemctl status wdg-scheduler --no-pager | head -8" 2>/dev/null || true
    return 1
  fi
}

restart_lima_db() {
  blue "[db] 重启 PostgreSQL ..."
  $LIMA_SSH "sudo systemctl restart wdg-postgres-agent 2>/dev/null || sudo systemctl restart postgresql" || {
    red "[db] PostgreSQL 重启失败"
    return 1
  }
  sleep 3

  # 验证 Lima VM 内 DB 可达 (5433 agent 专用)
  if $LIMA_SSH "pg_isready -h 127.0.0.1 -p 5433 -U agent -d agent_dev -t 10 2>/dev/null"; then
    green "[db] Lima 5433 (agent_dev) ready"
  else
    red "[db] Lima 5433 启动超时"
    return 1
  fi
  return 0
}

# ──────────────────────────────────────────────
# macOS launchd UI
# ──────────────────────────────────────────────

restart_ui() {
  blue "[ui] 停止 launchd UI ..."
  launchctl unload "$UI_PLIST" 2>/dev/null || true
  sleep 2

  # 确保端口释放
  if lsof -ti:3001 >/dev/null 2>&1; then
    yellow "[ui] 强制释放 3001 端口 ..."
    lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    sleep 1
  fi

  blue "[ui] 启动 launchd UI ..."
  launchctl load "$UI_PLIST" 2>/dev/null

  # 等 Next.js 编译完成 (dev 模式首次编译较慢, 给更多时间)
  green "[ui] 等待 dev server 编译完成 ..."
  if check_endpoint "http://localhost:3001" "UI :3001" 30 3; then
    return 0
  else
    red "[ui] 日志尾部:"
    tail -20 /tmp/wdg-launchd.log 2>/dev/null || true
    return 1
  fi
}

# ──────────────────────────────────────────────
# Lima port forwarding
# ──────────────────────────────────────────────

check_port_fwd() {
  local port=$1
  if lsof -ti:"$port" >/dev/null 2>&1; then
    green "  ✅ port $port forwarded"
    return 0
  else
    red "  ❌ port $port NOT forwarded — 需要重启 Lima VM"
    return 1
  fi
}

# ──────────────────────────────────────────────
# Lima VM 状态检查与恢复
# ──────────────────────────────────────────────

# check_lima_vm — 检查 Lima VM 是否运行，停止时自动启动
check_lima_vm() {
  local vm_name="${1:-wdg-dev}"
  local state
  state=$(limactl list --format '{{.Status}}' "$vm_name" 2>/dev/null || echo "unknown")

  if [ "$state" = "Running" ]; then
    green "  ✅ Lima VM '$vm_name' 运行中"
    return 0
  fi

  if [ "$state" = "Stopped" ]; then
    yellow "  ⚠️  Lima VM '$vm_name' 已停止 — 正在自动启动..."
    limactl start "$vm_name" || {
      red "  ❌ Lima VM '$vm_name' 启动失败"
      return 1
    }
    green "  ✅ Lima VM '$vm_name' 已启动"
    return 0
  fi

  red "  ❌ Lima VM '$vm_name' 状态异常: $state"
  return 1
}

# ──────────────────────────────────────────────
# 统一验证阶段 (所有模式结束后调用)
# ──────────────────────────────────────────────

verify_phase() {
  echo ""
  blue "═══════════════════════════════════════════"
  blue "  Verification — $(date '+%H:%M:%S')"
  blue "═══════════════════════════════════════════"
  echo ""

  local failures=0

  # ── Lima VM 状态 ──
  blue "--- Lima VM ---"
  check_lima_vm "wdg-dev" || failures=$((failures + 1))
  echo ""

  # ── 端口转发 ──
  blue "--- 端口转发 (macOS → Lima VM) ---"
  check_port_fwd 4101 || failures=$((failures + 1))
  check_port_fwd 5432 || failures=$((failures + 1))
  check_port_fwd 5433 || failures=$((failures + 1))

  # ── DB ──
  echo ""
  blue "--- 数据库 ---"
  # 5432: 主库 (本地 dev 连接) — mac 上没 psql，通过 Lima VM 探测
  if $LIMA_SSH "pg_isready -h host.lima.internal -p 5432 -U admin_jlin13 -d dataplatform_test -t 5" 2>/dev/null | grep -q "accepting"; then
    green "  ✅ DB :5432 (dataplatform_test) 可达 (via Lima)"
  else
    red "  ❌ DB :5432 不可达"
    failures=$((failures + 1))
  fi
  # 5433: Lima agent 专用库 (agent_dev)
  if $LIMA_SSH "pg_isready -h 127.0.0.1 -p 5433 -U agent -d agent_dev -t 5" 2>/dev/null | grep -q "accepting"; then
    green "  ✅ DB :5433 (agent_dev) 可达"
  else
    red "  ❌ DB :5433 不可达"
    failures=$((failures + 1))
  fi

  # ── Lima services ──
  echo ""
  blue "--- Lima VM systemd 服务 ---"
  check_service "wdg-agent" "Agent Service" || failures=$((failures + 1))
  check_service "wdg-scheduler" "Scheduler" || failures=$((failures + 1))

  # ── API 端点 ──
  echo ""
  blue "--- API 端点 ---"

  # Agent health (localhost:4101 是从 mac 端口转发进 Lima)
  check_endpoint "http://localhost:4101/health" "Agent Health :4101" 15 2 '"ok"' || failures=$((failures + 1))

  # Agent config (带 admin header, 确认 DB 配置完整)
  check_endpoint_hdr \
    "http://localhost:4101/api/admin/config" \
    "Agent Config (source=db)" \
    "x-wdg-user-role: admin" \
    15 2 \
    '"source":"db"' || {
    yellow "  → Agent config 诊断: $(curl -s -H 'x-wdg-user-role: admin' http://localhost:4101/api/admin/config 2>/dev/null | cut -c1-300)"
    failures=$((failures + 1))
  }

  # UI (macOS launchd)
  check_endpoint "http://localhost:3001" "UI :3001" 30 3 || failures=$((failures + 1))

  # UI admin config 页面 (验证 SSR 正常)
  check_endpoint "http://localhost:3001/u/admin/agent-config" "UI agent-config 页面" 10 2 || failures=$((failures + 1))

  # ── 报告 ──
  echo ""
  if [ "$failures" -eq 0 ]; then
    blue "═══════════════════════════════════════════"
    green "  ✅ 全部服务健康"
    blue "═══════════════════════════════════════════"
    echo ""
    green "  Agent:   http://localhost:4101/health"
    green "  UI:      http://localhost:3001"
    green "  Config:  http://localhost:3001/u/admin/agent-config"
  else
    red "═══════════════════════════════════════════"
    red "  ❌ $failures 项检查未通过"
    red "═══════════════════════════════════════════"
    echo ""
    yellow "  诊断命令:"
    yellow "    Lima journal:  $LIMA_SSH 'sudo journalctl -u wdg-agent --no-pager -n 20'"
    yellow "    UI 日志:       tail -50 /tmp/wdg-launchd.log"
    yellow "    重试验证:      bash scripts/dev_restart_all.sh --verify-only"
  fi
  echo ""
}

# ──────────────────────────────────────────────
# 全量重启
# ──────────────────────────────────────────────

restart_all() {
  echo ""
  blue "═══════════════════════════════════════════"
  blue "  WDG Dev Restart — $(date '+%H:%M:%S')"
  blue "═══════════════════════════════════════════"
  echo ""

  # 0. Lima VM — 先确保 VM 活着
  blue "--- Lima VM ---"
  check_lima_vm "wdg-dev" || { red "Lima VM 不可用，中止"; return 1; }
  echo ""

  # 1. Lima port forwarding
  blue "--- Lima Port Forwarding ---"
  check_port_fwd 4101 || true
  check_port_fwd 5432 || true
  check_port_fwd 5433 || true
  echo ""

  # 2. Lima VM 数据库
  blue "--- Lima VM DB ---"
  restart_lima_db || {
    red "[db] 数据库异常, 中止后续步骤"
    return 1
  }

  echo ""

  # 3. Lima VM 服务
  blue "--- Lima VM Services ---"

  # agent
  restart_lima_agent || {
    red "[agent] 启动异常, 中止后续步骤"
    return 1
  }

  # scheduler
  restart_lima_scheduler || true

  echo ""

  # 4. macOS UI
  blue "--- macOS UI (launchd) ---"
  restart_ui || {
    red "[ui] UI 启动异常, 中止后续步骤"
    return 1
  }

  # 5. 统一验证
  verify_phase
}

case "$MODE" in
  all)
    restart_all
    ;;
  --agent-only)
    echo ""
    blue "=== Agent Only ==="
    restart_lima_agent
    echo ""
    blue "--- Post-restart Check ---"
    check_endpoint "http://localhost:4101/health" "Agent Health" 10 2 '"ok"'
    check_endpoint "http://localhost:4101/api/admin/config" "Agent Config" 5 2 '"source":"db"'
    echo ""
    ;;
  --ui-only)
    echo ""
    blue "=== UI Only ==="
    restart_ui
    echo ""
    blue "--- Post-restart Check ---"
    check_endpoint "http://localhost:3001" "UI :3001" 20 3
    check_endpoint "http://localhost:3001/u/admin/agent-config" "UI agent-config" 10 2
    echo ""
    ;;
  --verify-only)
    verify_phase
    ;;
  *)
    echo "用法: bash scripts/dev_restart_all.sh [--agent-only|--ui-only|--verify-only]"
    echo ""
    echo "  (无参数)        重启全部 + 验证"
    echo "  --agent-only     只重启 Lima VM agent"
    echo "  --ui-only        只重启 macOS launchd UI"
    echo "  --verify-only    只验证，不重启"
    exit 1
    ;;
esac
