#!/bin/bash
# WDG systemd unit 安装脚本 (Linux VPS)
#
# 用法: sudo bash scripts/install_systemd.sh
#
# 行为 (spec 第 6.1 节):
#   1. 前置检查
#   2. 复制 5 个 unit + 1 个 target 到 /etc/systemd/system/
#   3. 写 env 文件
#   4. initdb (仅 PGDATA 为空时)
#   5. 写 postgresql.conf / pg_hba.conf
#   6. 启主 PG + agent-test-db
#   7. 创建应用 DB + 用户
#   8. 应用 agent schema
#   9. 启 UI + Agent
#  10. 跑 verify
#
# 警告: 本脚本**只创建空 PGDATA 时**跑 initdb。已有 PGDATA 不会动。
#       重跑安全 (initdb 跳过, 已有 PGDATA 跳过, unit 文件覆盖)。
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/wdg}"
PG_VERSION="16"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
PGDATA_MAIN="/var/lib/postgresql/${PG_VERSION}/main"
PGDATA_AGENT="/var/lib/postgresql/${PG_VERSION}/agent_main"
PGPORT_MAIN=5432
PGPORT_AGENT=5433

ENV_DIR="/etc/wdg"
ENV_MAIN="${ENV_DIR}/postgres.env"
ENV_AGENT="${ENV_DIR}/postgres-agent.env"

SYSTEMD_DIR="/etc/systemd/system"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SYSTEMD_DIR="${REPO_DIR}/deploy/systemd"

# 1. 前置检查
echo "==> 前置检查..."
for cmd in systemctl sudo psql python3; do
  command -v "$cmd" >/dev/null || { echo "!! 缺少命令: $cmd" >&2; exit 1; }
done
[ -d "$REPO_DIR" ] || { echo "!! 仓库目录不存在: $REPO_DIR" >&2; exit 1; }
[ -f "${REPO_DIR}/.env" ] || { echo "!! .env 不存在: ${REPO_DIR}/.env" >&2; exit 1; }
[ -d "$REPO_SYSTEMD_DIR" ] || { echo "!! 找不到 unit 源目录: $REPO_SYSTEMD_DIR" >&2; exit 1; }

# 2. 复制 unit
echo "==> 复制 systemd unit..."
install -m 0644 "${REPO_SYSTEMD_DIR}/wdg-postgres.service" "${SYSTEMD_DIR}/"
install -m 0644 "${REPO_SYSTEMD_DIR}/wdg-postgres-agent.service" "${SYSTEMD_DIR}/"
install -m 0644 "${REPO_SYSTEMD_DIR}/wdg-ui.service" "${SYSTEMD_DIR}/"
install -m 0644 "${REPO_SYSTEMD_DIR}/wdg-agent.service" "${SYSTEMD_DIR}/"
install -m 0644 "${REPO_SYSTEMD_DIR}/wdg.target" "${SYSTEMD_DIR}/"
[ -f "${REPO_SYSTEMD_DIR}/wdg-scheduler.service" ] && \
  install -m 0644 "${REPO_SYSTEMD_DIR}/wdg-scheduler.service" "${SYSTEMD_DIR}/"
systemctl daemon-reload

# 3. 写 env 文件
echo "==> 写 env 文件..."
mkdir -p "$ENV_DIR"
python3 -c "
import sys
sys.path.insert(0, '${SCRIPT_DIR}')
from lib.install_helpers import env_file_contents
open('${ENV_MAIN}', 'w').write(env_file_contents(role='main', pg_data='${PGDATA_MAIN}', pg_port=${PGPORT_MAIN}))
open('${ENV_AGENT}', 'w').write(env_file_contents(role='agent', pg_data='${PGDATA_AGENT}', pg_port=${PGPORT_AGENT}))
"
chmod 0644 "${ENV_MAIN}" "${ENV_AGENT}"

# 4. initdb (仅空 PGDATA)
echo "==> 检查 PGDATA..."
if [ ! -f "${PGDATA_MAIN}/PG_VERSION" ]; then
  echo "==> 主 PGDATA 空, initdb..."
  sudo -u postgres "${PG_BIN}/initdb" -D "$PGDATA_MAIN" --encoding=UTF8 --locale=C
else
  echo "==> 主 PGDATA 已存在, 跳过 initdb"
fi
if [ ! -f "${PGDATA_AGENT}/PG_VERSION" ]; then
  echo "==> agent PGDATA 空, initdb..."
  sudo -u postgres "${PG_BIN}/initdb" -D "$PGDATA_AGENT" --encoding=UTF8 --locale=C
else
  echo "==> agent PGDATA 已存在, 跳过 initdb"
fi

# 5. 写 postgresql.conf / pg_hba.conf 覆盖段
echo "==> 写 postgresql.conf / pg_hba.conf..."
for cluster in "main:${PGPORT_MAIN}" "agent_main:${PGPORT_AGENT}"; do
  PGDATA="${PGDATA_MAIN}"
  PORT="${PGPORT_MAIN}"
  case "$cluster" in
    "main:${PGPORT_MAIN}") PGDATA="$PGDATA_MAIN"; PORT="$PGPORT_MAIN" ;;
    "agent_main:${PGPORT_AGENT}") PGDATA="$PGDATA_AGENT"; PORT="$PGPORT_AGENT" ;;
  esac

  CONF="${PGDATA}/postgresql.conf"
  HBA="${PGDATA}/pg_hba.conf"
  WDG_MARK="# --- WDG systemd override ---"

  # append-only: 没写过的才追加
  if ! grep -q "$WDG_MARK" "$CONF" 2>/dev/null; then
    python3 -c "
import sys
sys.path.insert(0, '${SCRIPT_DIR}')
from lib.install_helpers import postgres_conf_overrides
with open('$CONF', 'a') as f: f.write(postgres_conf_overrides(port=$PORT))
"
  fi
  if ! grep -q "host all all 127.0.0.1/32 md5" "$HBA" 2>/dev/null; then
    echo "host all all 127.0.0.1/32 md5" >> "$HBA"
  fi
  chown -R postgres:postgres "$PGDATA"
done

# 6. 启 PG
echo "==> 启动 PG..."
systemctl enable --now wdg-postgres wdg-postgres-agent
sleep 2
systemctl is-active wdg-postgres || { echo "!! 主 PG 启动失败" >&2; exit 1; }
systemctl is-active wdg-postgres-agent || { echo "!! agent PG 启动失败" >&2; exit 1; }

# 7. 创建应用 DB + 用户 (从 .env 读)
echo "==> 创建应用 DB + 用户..."
set -a; source "${REPO_DIR}/.env"; set +a
sudo -u postgres psql -p "${PGPORT_MAIN}" -c "ALTER USER postgres WITH PASSWORD '${DB_PASSWORD}';" || true
sudo -u postgres psql -p "${PGPORT_MAIN}" -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -p "${PGPORT_MAIN}" "${DB_NAME}"

sudo -u postgres psql -p "${PGPORT_AGENT}" -c "CREATE USER agent WITH PASSWORD 'local-dev-only';" 2>/dev/null || true
sudo -u postgres psql -p "${PGPORT_AGENT}" -tc "SELECT 1 FROM pg_database WHERE datname='agent_dev'" | grep -q 1 \
  || sudo -u postgres createdb -p "${PGPORT_AGENT}" -O agent agent_dev

# 8. 应用 agent schema
echo "==> 应用 agent schema..."
PGPASSWORD=local-dev-only psql -h 127.0.0.1 -p "${PGPORT_AGENT}" -U agent -d agent_dev \
  -f "${REPO_DIR}/sql/00_agent_schema.sql"

# 9. 启 UI + Agent
echo "==> 启动 UI + Agent..."
systemctl enable --now wdg-ui wdg-agent
sleep 5

# 10. 验证
echo "==> 验证..."
"${SCRIPT_DIR}/verify_systemd.sh" || { echo "!! 验证失败, 看 journalctl" >&2; exit 1; }

echo
echo "==> install_systemd.sh 完成"
echo "==> 下一步: 如有数据要从 docker 迁过来, 跑 scripts/migrate_docker_to_systemd.sh"
