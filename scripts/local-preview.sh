#!/bin/bash
# scripts/local-preview.sh
# 起本地预览环境 (3 services + 1 隔离 test DB)
# 用法: ./scripts/local-preview.sh
#
# 服务:
#   - agent-test-db   : 5433 -> 隔离 test DB (postgres:16-alpine, agent_dev 库)
#   - postgres        : 5432 (本地) -> production-equivalent DB (供 UI 用)
#   - ui              : ${UI_PORT:-3002} -> Next.js
#   - agent           : 4101 -> Agent Fastify (DATABASE_URL -> agent-test-db)
#
# 注意:
#   - 不连任何外部 / 生产 DB
#   - ANTHROPIC_API_KEY 缺失时 agent 仍能起, /health 会 200, 但不会真调 LLM
#   - mock 数据从 sql/00_agent_schema.sql (initdb) + scripts/seed-mock-data.sql 灌入

set -e

cd "$(dirname "$0")/.."

# ─── 1. 准备 .env (如果没有) ─────────────────
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "  Mock data + health checks work without ANTHROPIC_API_KEY"
  echo "  Edit .env to set ANTHROPIC_API_KEY if you want agent to call LLM"
fi

# ─── 2. 起 docker ─────────────────
echo ""
echo "Starting docker compose (4 services: postgres + ui + agent + agent-test-db)..."
docker compose up -d

# ─── 3. 等 test DB 就绪 ─────────────────
echo ""
echo "Waiting for agent-test-db to be healthy..."
HEALTHY=false
for i in {1..30}; do
  if docker compose ps agent-test-db --format '{{.Status}}' 2>/dev/null | grep -qi "healthy"; then
    echo "  agent-test-db is healthy"
    HEALTHY=true
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  agent-test-db not healthy after 30s"
    docker compose logs --tail=20 agent-test-db
    exit 1
  fi
  sleep 1
done

# ─── 4. 插入 mock 数据 (idempotent) ─────────────────
# 注意: agent-test-db 在 initdb 时会跑 ./sql/00_agent_schema.sql 自动建 schema
# 这里只跑 seed 灌 mock 业务数据
echo ""
echo "Seeding mock data into agent_dev..."
if [ -f scripts/seed-mock-data.sql ]; then
  cat scripts/seed-mock-data.sql | docker compose exec -T agent-test-db \
    psql -U agent -d agent_dev 2>&1 | tail -10 || echo "  seed partially failed (check logs above)"
else
  echo "  scripts/seed-mock-data.sql not found, skipping"
fi

# ─── 5. 等 agent 起来 ─────────────────
echo ""
echo "Waiting for agent service..."
for i in {1..20}; do
  if curl -sf http://localhost:4101/health >/dev/null 2>&1; then
    echo "  agent /health returned 200"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "  agent not healthy after 20s"
    docker compose logs --tail=20 agent
  fi
  sleep 1
done

# ─── 6. 验证 ─────────────────
echo ""
echo "============================================================"
echo "  Local preview ready!"
echo "============================================================"
echo ""
echo "Service status:"
docker compose ps --format "  - {{.Service}}: {{.Status}}" 2>/dev/null | grep -E "agent|ui|postgres|metabase" || true
echo ""
echo "Health checks:"
if curl -sf http://localhost:4101/health >/dev/null 2>&1; then
  HEALTH_BODY=$(curl -s http://localhost:4101/health)
  echo "  agent /health   : 200 ($HEALTH_BODY)"
else
  echo "  agent /health   : not responding on 4101"
fi
if curl -sf http://localhost:3002/ -o /dev/null 2>&1; then
  echo "  ui /            : 200 (port 3002)"
else
  echo "  ui /            : not responding on 3002"
fi
echo ""
echo "Try:"
echo "  curl http://localhost:4101/health"
echo "  curl http://localhost:4101/metrics | head -20"
echo "  open http://localhost:3002/login"
echo "  open http://localhost:3002/u/notifications  (after login)"
echo ""
echo "Test DB (psql):"
echo "  docker compose exec agent-test-db psql -U agent -d agent_dev"
echo "  SELECT COUNT(*) FROM agent.conversations;"
echo "  SELECT COUNT(*) FROM agent.tasks;"
echo ""
echo "To stop: docker compose down"
echo "To reset test DB: docker compose down -v  (then up again)"
