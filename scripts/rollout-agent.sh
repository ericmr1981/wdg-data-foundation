#!/bin/bash
# scripts/rollout-agent.sh
# 5 阶段切流工具
# 用法: ./scripts/rollout-agent.sh <0|10|50|100>

set -e
PERCENT=$1

if [[ ! "$PERCENT" =~ ^(0|10|50|100)$ ]]; then
  echo "Usage: $0 <0|10|50|100>"
  exit 1
fi

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo ".env not found"
  exit 1
fi

# 1. 改 .env
if grep -q "NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=" "$ENV_FILE"; then
  sed -i '' "s/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=.*/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=$PERCENT/" "$ENV_FILE"
else
  echo "NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=$PERCENT" >> "$ENV_FILE"
fi

echo "Set NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=$PERCENT in $ENV_FILE"

# 2. 重启 ui 让 env 生效
if command -v docker >/dev/null 2>&1; then
  if docker compose ps ui >/dev/null 2>&1; then
    docker compose restart ui
    echo "Restarted ui. Verify with: docker compose logs ui | grep AGENT"
  else
    echo "docker compose not running, manually restart ui"
  fi
else
  echo "docker not available, manually restart ui process"
fi
