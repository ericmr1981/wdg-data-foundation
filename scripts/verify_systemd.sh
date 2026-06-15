#!/bin/bash
# WDG systemd stack 健康检查
# 7 项检查 (spec 第 6.4 节), 全部通过退出 0, 任一失败退出 1。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

run_check() {
  local name="$1"
  shift
  echo "==> [$name]"
  if "$@"; then
    echo "    OK"
  else
    echo "    !! FAILED"
    FAIL=1
  fi
}

# 1. wdg.target active
check_target() {
  [ "$(systemctl is-active wdg.target)" = "active" ]
}
run_check "wdg.target active" check_target

# 2. agent health
check_agent_health() {
  curl -fsS --max-time 5 http://127.0.0.1:4101/health >/dev/null
}
run_check "agent health" check_agent_health

# 3. ui health
check_ui_health() {
  curl -fsS --max-time 5 http://127.0.0.1:3000/ >/dev/null
}
run_check "ui health" check_ui_health

# 4. main DB has data
check_main_db() {
  local count
  count=$(sudo -u postgres psql -p 5432 -d dataplatform -tAc \
    "SELECT count(*) FROM raw.ingest_file" 2>/dev/null)
  [ "${count:-0}" -ge 1 ]
}
run_check "main DB has data" check_main_db

# 5. agent DB has tables
check_agent_db() {
  local n
  n=$(sudo -u postgres psql -p 5433 -d agent_dev -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='agent'" 2>/dev/null)
  [ "${n:-0}" -ge 1 ]
}
run_check "agent DB has tables" check_agent_db

# 6. scheduler health
check_scheduler_health() {
  curl -fsS --max-time 5 http://127.0.0.1:4711/health >/dev/null
}
run_check "scheduler health" check_scheduler_health

# 7. no FATAL in PG journal (用 helpers 解析)
check_no_fatal() {
  local journal fatal
  journal=$(journalctl -u wdg-postgres -n 20 --no-pager 2>/dev/null || echo "")
  fatal=$(python3 -c "
import sys
sys.path.insert(0, '$SCRIPT_DIR')
from lib.verify_helpers import parse_journalctl_fatal
sys.exit(0 if not parse_journalctl_fatal(sys.stdin.read()) else 1)
" <<< "$journal")
  [ "$fatal" = "0" ]
}
run_check "no FATAL in PG journal" check_no_fatal

echo
if [ "$FAIL" -eq 0 ]; then
  echo "==> 全部通过"
  exit 0
else
  echo "==> 验证失败, 看上面 FAILED 项 + journalctl -u wdg-*"
  exit 1
fi
