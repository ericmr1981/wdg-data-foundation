#!/bin/bash
# 从 docker 容器 dump 数据, restore 到 systemd 跑的原生 PG。
#
# 假设 install_systemd.sh 已跑过, systemd 服务已起来, DB / 用户 / schema 都建好。
# 本脚本只搬数据。
#
# 安全: 失败保留 dump 文件, 不删 docker 容器。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMP_DIR="/tmp/wdg-migrate-$$"
MAIN_CONTAINER="dataplatform-pg-dashboard"
AGENT_CONTAINER="wdg-agent-test-db"
MAIN_USER="postgres"
MAIN_DB="dataplatform"
AGENT_USER="agent"
AGENT_DB="agent_dev"

mkdir -p "$DUMP_DIR"
trap "rm -rf '$DUMP_DIR'" EXIT

# 0. 停 systemd 应用层 (避免并发写)
echo "==> 停 systemd 应用层..."
systemctl stop wdg-ui wdg-agent 2>/dev/null || true

# 1. 检查容器在跑
echo "==> 检查 docker 容器..."
for c in "$MAIN_CONTAINER" "$AGENT_CONTAINER"; do
  if ! docker ps --format '{{.Names}}' | grep -q "^$c\$"; then
    echo "!! 容器 $c 没在跑" >&2
    exit 1
  fi
done

# 2. dump
echo "==> dump 主库..."
docker exec -e PGPASSWORD="$MAIN_USER" "$MAIN_CONTAINER" \
  pg_dump -U "$MAIN_USER" -Fc --no-owner --no-privileges "$MAIN_DB" \
  > "${DUMP_DIR}/${MAIN_DB}.dump"

echo "==> dump agent 库..."
docker exec -e PGPASSWORD="local-dev-only" "$AGENT_CONTAINER" \
  pg_dump -U "$AGENT_USER" -Fc --no-owner --no-privileges "$AGENT_DB" \
  > "${DUMP_DIR}/${AGENT_DB}.dump"

ls -lh "$DUMP_DIR"

# 3. restore (用 helpers 构造的命令, 实际跑由 shell 执行)
echo "==> restore 主库..."
RESTORE_MAIN=$(python3 -c "
import sys, shlex
sys.path.insert(0, '$SCRIPT_DIR')
from lib.migrate_helpers import pg_restore_command
print(' '.join(shlex.quote(c) for c in pg_restore_command(
    host='127.0.0.1', port=5432, user='$MAIN_USER', db='$MAIN_DB',
    dump_path='${DUMP_DIR}/${MAIN_DB}.dump', role='$MAIN_USER',
)))
")
PGPASSWORD="${DB_PASSWORD:-postgres}" bash -c "$RESTORE_MAIN" || {
  echo "!! restore 主库失败, dump 保留在 $DUMP_DIR" >&2
  exit 1
}

echo "==> restore agent 库..."
RESTORE_AGENT=$(python3 -c "
import sys, shlex
sys.path.insert(0, '$SCRIPT_DIR')
from lib.migrate_helpers import pg_restore_command
print(' '.join(shlex.quote(c) for c in pg_restore_command(
    host='127.0.0.1', port=5433, user='$AGENT_USER', db='$AGENT_DB',
    dump_path='${DUMP_DIR}/${AGENT_DB}.dump', role='$AGENT_USER',
)))
")
PGPASSWORD="local-dev-only" bash -c "$RESTORE_AGENT" || {
  echo "!! restore agent 库失败, dump 保留在 $DUMP_DIR" >&2
  exit 1
}

# 4. 启动 systemd 应用层
echo "==> 启动 systemd 应用层..."
systemctl start wdg-ui wdg-agent

# 5. 验证
echo "==> 验证..."
"${SCRIPT_DIR}/verify_systemd.sh" || { echo "!! 验证失败" >&2; exit 1; }

echo "==> 迁移完成, dump 在 $DUMP_DIR (脚本退出时会清空)"
echo "==> 建议保留一段时间: cp -r $DUMP_DIR ~/Documents/wdg-backups/"
