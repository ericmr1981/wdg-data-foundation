#!/bin/bash
# 校验 systemd native PG vs docker fallback PG 行数一致
# 在 PR #8 merge + 删 docker 容器 之前必跑,确保 native 是 source of truth
#
# 用法: sudo bash scripts/verify_data_sync.sh
# 退出 0 = 完全一致, 1 = 有差异
set -uo pipefail

FAIL=0

# 1. 主库对比
NATIVE_MAIN=$(sudo -u postgres psql -p 5432 -d dataplatform -tAc \
  "SELECT 'raw.ingest_file: ' || count(*) FROM raw.ingest_file
   UNION ALL SELECT 'gelatomiiix_ods.income_detail: ' || count(*) FROM gelatomiiix_ods.income_detail
   UNION ALL SELECT 'brand_tamkoko_ods.income_detail: ' || count(*) FROM brand_tamkoko_ods.income_detail" \
  2>/dev/null | sort)

DOCKER_MAIN=$(docker exec postgres psql -U admin_jlin13 -d dataplatform -tAc \
  "SELECT 'raw.ingest_file: ' || count(*) FROM raw.ingest_file
   UNION ALL SELECT 'gelatomiiix_ods.income_detail: ' || count(*) FROM gelatomiiix_ods.income_detail
   UNION ALL SELECT 'brand_tamkoko_ods.income_detail: ' || count(*) FROM brand_tamkoko_ods.income_detail" \
  2>/dev/null | sort)

echo "==> [主库 native (5432) vs docker (9742)]"
if [ "$NATIVE_MAIN" = "$DOCKER_MAIN" ]; then
  echo "    OK — 一致"
  echo "$NATIVE_MAIN" | sed 's/^/      /'
else
  echo "    !! FAILED — 不一致"
  echo "    native:"
  echo "$NATIVE_MAIN" | sed 's/^/      /'
  echo "    docker:"
  echo "$DOCKER_MAIN" | sed 's/^/      /'
  FAIL=1
fi
echo ""

# 2. agent 库对比
NATIVE_AGENT=$(sudo -u postgres psql -p 5433 -d agent_dev -tAc \
  "SELECT 'agent.conversations: ' || count(*) FROM agent.conversations
   UNION ALL SELECT 'agent.messages: ' || count(*) FROM agent.messages
   UNION ALL SELECT 'agent.tasks: ' || count(*) FROM agent.tasks
   UNION ALL SELECT 'agent.task_steps: ' || count(*) FROM agent.task_steps
   UNION ALL SELECT 'agent.audit_log: ' || count(*) FROM agent.audit_log" \
  2>/dev/null | sort)

DOCKER_AGENT=$(docker exec wdg-agent-test-db psql -U agent -d agent_dev -tAc \
  "SELECT 'agent.conversations: ' || count(*) FROM agent.conversations
   UNION ALL SELECT 'agent.messages: ' || count(*) FROM agent.messages
   UNION ALL SELECT 'agent.tasks: ' || count(*) FROM agent.tasks
   UNION ALL SELECT 'agent.task_steps: ' || count(*) FROM agent.task_steps
   UNION ALL SELECT 'agent.audit_log: ' || count(*) FROM agent.audit_log" \
  2>/dev/null | sort)

echo "==> [agent 库 native (5433) vs docker (wdg-agent-test-db)]"
if [ "$NATIVE_AGENT" = "$DOCKER_AGENT" ]; then
  echo "    OK — 一致"
  echo "$NATIVE_AGENT" | sed 's/^/      /'
else
  echo "    !! FAILED — 不一致"
  echo "    native:"
  echo "$NATIVE_AGENT" | sed 's/^/      /'
  echo "    docker:"
  echo "$DOCKER_AGENT" | sed 's/^/      /'
  FAIL=1
fi
echo ""

if [ $FAIL -eq 0 ]; then
  echo "==> 全部一致, native 可作为 source of truth, 可删 docker 容器"
  exit 0
else
  echo "==> !! 有差异, 不要删 docker 容器, 先 re-migrate"
  exit 1
fi
