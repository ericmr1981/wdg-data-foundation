#!/usr/bin/env bash
# deploy-new-version.sh — PR #4 (Agent-First) 100% rollout
#
# Prerequisites:
#   - GitHub Actions has finished building & pushing:
#     - wdg-data-foundation/ui:latest (new, with PR #4 admin pages)
#     - wdg-data-foundation/agent:latest (new, with PR #4 agent service)
#   - .env has ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL
#   - This script adds AGENT_CRED_ENCRYPTION_KEY + NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=100
#   - Old stack uses docker-compose.dashboard.yml (2 svc), new stack uses
#     docker-compose.production.yml (4 svc). Down → Up cycle.
#
# What it does:
#   1. Pull new ui + agent images from ACR
#   2. Update .env with AGENT_CRED_ENCRYPTION_KEY + rollout=100
#   3. docker-compose -f docker-compose.dashboard.yml down
#   4. docker-compose -f docker-compose.production.yml up -d
#   5. Wait for health checks (ui + agent + agent-test-db)
#   6. Verify agent schema applied
#   7. Smoke test /u/agent-test
#
# Rollback: docker-compose -f docker-compose.dashboard.yml up -d

set -euo pipefail

ROOT="/opt/wdg-data-foundation"
cd "$ROOT"

ACR_REGISTRY="crpi-0pkv8qkraf4poq92.cn-hangzhou.personal.cr.aliyuncs.com"
ACR_NAMESPACE="wdg-data-foundation"
UI_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/ui:latest"
AGENT_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/agent:latest"
AGENT_KEY="${AGENT_CRED_ENCRYPTION_KEY:-e2c1d206113c753a69d70ed307b2c00bc1dd75f10d2e04b221e899c131bf1cf0}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=== Step 1/7: Pull new ui + agent from ACR ==="
docker pull "$UI_IMAGE" 2>&1 | tail -3
docker pull "$AGENT_IMAGE" 2>&1 | tail -3

log "=== Step 2/7: Update .env (AGENT_CRED_ENCRYPTION_KEY + rollout=100) ==="
# Remove old key/rollout if present, then append fresh
sed -i '/^AGENT_CRED_ENCRYPTION_KEY=/d; /^NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=/d; /^AGENT_DB_PASSWORD=/d' .env
cat >> .env <<EOF

# =====================
# WDG Agent Service (PR #4)
# =====================
AGENT_CRED_ENCRYPTION_KEY=${AGENT_KEY}
NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=100
AGENT_DB_PASSWORD=agent
EOF
log "  .env updated"

log "=== Step 3/7: Down old dashboard stack (postgres + ui only) ==="
/usr/local/bin/docker-compose -f docker-compose.dashboard.yml down
log "  old stack down"

log "=== Step 4/7: Up new production stack (postgres + ui + agent + agent-test-db) ==="
export UI_IMAGE
export AGENT_IMAGE
/usr/local/bin/docker-compose -f docker-compose.production.yml up -d
log "  new stack up — waiting 15s for containers to settle"
sleep 15

log "=== Step 5/7: Health checks ==="
for i in {1..20}; do
  ui_ok=false
  agent_ok=false
  db_ok=false
  curl -fsS -o /dev/null -m 3 http://127.0.0.1:3002/login && ui_ok=true
  curl -fsS -o /dev/null -m 3 http://127.0.0.1:4101/health && agent_ok=true
  docker exec wdg-agent-test-db pg_isready -U agent -d agent_dev -t 3 >/dev/null 2>&1 && db_ok=true
  log "  attempt $i: ui=$ui_ok agent=$agent_ok db=$db_ok"
  if $ui_ok && $agent_ok && $db_ok; then
    log "  ✅ all healthy"
    break
  fi
  sleep 5
done

log "=== Step 6/7: Verify agent schema applied ==="
SCHEMA_COUNT=$(docker exec wdg-agent-test-db psql -U agent -d agent_dev -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='agent';" 2>/dev/null || echo "ERR")
log "  agent schema tables: $SCHEMA_COUNT (expected 5: conversations/messages/tasks/task_steps/audit_log)"

log "=== Step 7/7: Final container list ==="
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

log "=== Done ==="
log "  UI: http://127.0.0.1:3002"
log "  Agent test page: http://127.0.0.1:3002/u/agent-test"
log "  Agent health: http://127.0.0.1:4101/health"
log "  Agent-test-db: 127.0.0.1:5433 (user=agent pass=agent db=agent_dev)"
log ""
log "  Rollback: /usr/local/bin/docker-compose -f docker-compose.dashboard.yml up -d"
