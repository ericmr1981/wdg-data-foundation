#!/bin/bash
# ============================================================
# 补跑本次 commit 涉及的 DB 迁移
# 用法: bash sql/migrate-all.sh [--agent-db ...] [--pg-db ...] [--supabase-dsn ...]
#
# 环境变量:
#   AGENT_DSN     — agent 配置库 (默认: postgresql://agent@127.0.0.1:5433/agent_dev)
#   PG_DSN        — Foundation 主库 (默认: $DB_DSN 或 $SUPABASE_DB_URL)
#   SUPABASE_DSN  — Supabase 库 (默认: 同 PG_DSN, 或手动跑 SQL Editor)
#
# Supabase 迁移也可在 Supabase Dashboard → SQL Editor 中逐条粘贴。
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

AGENT_DSN="${AGENT_DSN:-postgresql://agent@127.0.0.1:5433/agent_dev}"
PG_DSN="${PG_DSN:-${DB_DSN:-${SUPABASE_DB_URL:-}}}"
SUPABASE_DSN="${SUPABASE_DSN:-$PG_DSN}"

echo "=========================================="
echo "WDG Data Foundation — DB 迁移补跑"
echo "commit: feat(agent): UnifiedMcpBridge + Supabase 迁移 + admin 扩展"
echo "=========================================="
echo ""

# ─── 1. agent.config 加 mcp_backends ──────────────
echo "[1/4] agent.config: 加 mcp_backends JSONB 列"
if [ -n "${AGENT_DSN:-}" ]; then
  psql "$AGENT_DSN" -f "$DIR/01b_agent_config_mcp_backends.sql"
  echo "  ✅ agent 配置库迁移完成"
else
  echo "  ⚠️  AGENT_DSN 未设置，跳过"
fi
echo ""

# ─── 1b. agent.config 加 mcp_backend_tokens (加密的 token 列) ────
echo "[1b/4] agent.config: 加 mcp_backend_tokens JSONB 列 (加密 Bearer tokens)"
if [ -n "${AGENT_DSN:-}" ]; then
  psql "$AGENT_DSN" -f "$DIR/01c_agent_config_mcp_backend_tokens.sql"
  echo "  ✅ agent 配置库 mcp_backend_tokens 迁移完成"
else
  echo "  ⚠️  AGENT_DSN 未设置，跳过"
fi
echo ""

# ─── 2. Supabase: public.users 兼容 ────────────────
echo "[2/4] Supabase: public.users 加 enabled + role 约束放宽"
echo "  可直接在 Supabase Dashboard → SQL Editor 运行:"
echo "  sql/70_supabase_users_migration.sql"
if [ -n "${SUPABASE_DSN:-}" ]; then
  psql "$SUPABASE_DSN" -f "$DIR/70_supabase_users_migration.sql"
  echo "  ✅ Supabase 用户迁移完成"
else
  echo "  ⚠️  SUPABASE_DSN 未设置，请手动运行"
fi
echo ""

# ─── 3. Foundation: ops.sessions 加 role/username ─
echo "[3/4] Foundation: ops.sessions 加 role/username 列"
if [ -n "${PG_DSN:-}" ]; then
  psql "$PG_DSN" -f "$DIR/71_sessions_add_role.sql"
  echo "  ✅ Foundation session 迁移完成"
else
  echo "  ⚠️  PG_DSN 未设置，跳过"
fi
echo ""

# ─── 4. Supabase: admin RPC 函数 ─────────────────
echo "[4/4] Supabase: 替换 admin_* RPC 函数（兼容 username/enabled）"
echo "  可直接在 Supabase Dashboard → SQL Editor 运行:"
echo "  sql/72_supabase_admin_rpc.sql"
if [ -n "${SUPABASE_DSN:-}" ]; then
  psql "$SUPABASE_DSN" -f "$DIR/72_supabase_admin_rpc.sql"
  echo "  ✅ Supabase RPC 迁移完成"
else
  echo "  ⚠️  SUPABASE_DSN 未设置，请手动运行"
fi
echo ""

echo "=========================================="
echo "全部迁移执行完毕。"
echo ""
echo "Supabase 迁移也可在 Dashboard SQL Editor 中运行:"
echo "  sql/70_supabase_users_migration.sql"
echo "  sql/72_supabase_admin_rpc.sql"
echo "=========================================="
