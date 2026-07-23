-- Migration: 给 agent.config 加 mcp_backend_tokens 字段
-- 用于 AES-256-GCM 加密存储外部 MCP backend 的 Bearer token。
-- 加密走 AGENT_CRED_ENCRYPTION_KEY env,跟 api key 同把密钥。
-- 结构: { backend_name: encrypted_ciphertext }
-- 例如: {"DailyCheck": "Y2lwaGVydGV4dA==..."}
-- 跑法: psql -h 127.0.0.1 -p 5433 -U agent -d agent_dev -f sql/01c_agent_config_mcp_backend_tokens.sql
--    或: bash sql/migrate-all.sh

DO $$ BEGIN
  ALTER TABLE agent.config ADD COLUMN mcp_backend_tokens JSONB;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

COMMENT ON COLUMN agent.config.mcp_backend_tokens IS '外部 MCP backend 的加密 Bearer tokens (JSONB)。每项: {backend_name: encrypted_ciphertext}。加密算法见 agent/src/crypto/secret-crypto.ts。';
