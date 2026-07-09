#!/usr/bin/env bash
# 一键 seed agent.config 行 (用当前 env 写 DB)
# 用法 (VM 内或 mac 端):
#   ANTHROPIC_API_KEY=sk-... \
#   AGENT_CRED_ENCRYPTION_KEY=dev-crypto-key-... \
#     bash scripts/seed-agent-config.sh
#
# 默认连 127.0.0.1:5433 (agent_dev), 可在环境变量覆盖。

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; NC=$'\033[0m'
log() { echo "${GREEN}[INFO]${NC} $*"; }
die() { echo "${RED}[ERR]${NC} $*" >&2; exit 1; }

# ── 配置 ──
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-agent}"
PGDATABASE="${PGDATABASE:-agent_dev}"
BASE_URL="${ANTHROPIC_BASE_URL:-https://api.anthropic.com}"
MODEL="${ANTHROPIC_MODEL:-claude-opus-4-8}"

# ── 验证环境变量 ──
[ -n "${ANTHROPIC_API_KEY:-}" ]  || die "需要 ANTHROPIC_API_KEY"
[ -n "${AGENT_CRED_ENCRYPTION_KEY:-}" ] || die "需要 AGENT_CRED_ENCRYPTION_KEY"

# ── 加密 (用 Node 的 secret-crypto lib, 在 mac 或 VM 都行) ──
# 尝试两种方式: (1) 项目源码 (2) 编译后 dist
if [ -f "$PROJECT_DIR/agent/dist/crypto/secret-crypto.js" ]; then
  MODULE="$PROJECT_DIR/agent/dist/crypto/secret-crypto.js"
else
  die "找不到 agent/dist/crypto/secret-crypto.js, 先 build (cd agent && npm run build)"
fi

ENCRYPTED=$(
  node -e "
const { encrypt } = require('$MODULE');
console.log(encrypt('${ANTHROPIC_API_KEY}', '${AGENT_CRED_ENCRYPTION_KEY}'));
"
)
log "加密后密文长度: ${#ENCRYPTED}"

# ── 写 DB ──
PSQL_CMD="PGPASSWORD=${PGPASSWORD:-local-dev-only} psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -v ON_ERROR_STOP=1"

log "写入 agent.config (id=1)..."

$PSQL_CMD <<SQL
INSERT INTO agent.config (id, base_url, encrypted_key, model, updated_at, updated_by)
VALUES (1, '${BASE_URL}', '${ENCRYPTED}', '${MODEL}', NOW(), 'seed-script')
ON CONFLICT (id) DO UPDATE SET
  base_url      = EXCLUDED.base_url,
  encrypted_key = EXCLUDED.encrypted_key,
  model         = EXCLUDED.model,
  updated_at    = NOW(),
  updated_by    = EXCLUDED.updated_by
SQL

log "agent.config 已 seed。重启 Agent:"
log "  sudo systemctl restart wdg-agent.service"
log "  journalctl -u wdg-agent.service -f"
