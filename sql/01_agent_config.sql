-- agent.config — Agent 运行配置(单行)
-- 储存 base_url / api_key / model / params 等
-- api_key 用 AGENT_CRED_ENCRYPTION_KEY (AES-256-GCM) 加密
--
-- 由 phase-1 引入: 让 Agent config 走 DB 而不是 env
-- 倒序读取优先级: DB → env(legacy) → null (503)
--
-- 跑这个文件:
--   psql -h 127.0.0.1 -p 5433 -U agent -d agent_dev -f sql/01_agent_config.sql

BEGIN;

CREATE TABLE IF NOT EXISTS agent.config (
  id              INT  PRIMARY KEY DEFAULT 1,
  base_url        TEXT,
  encrypted_key   TEXT,             -- AES-256-GCM(由 AGENT_CRED_ENCRYPTION_KEY 加密)
  model           TEXT,
  params          JSONB,            -- AgentConfigParams (maxTokens/temperature/...)
  agent_md        TEXT,             -- 当前活跃的 agent.md 内容(可选,文件仍是 source of truth)
  jwks_url        TEXT,             -- Portal JWKS 端点,用于 WS/HTTP JWT 验签 (agent.config 优先于 AGENT_JWKS_URL env)
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT,
  CONSTRAINT single_row CHECK (id = 1)
);

-- 单行 trigger 设计 NOTES:
-- 单行的 强制 是由 CHECK (id = 1) 提供的(主键 + check 不可重复),
-- 不需要 trigger。Phase 1 的版本有 BEFORE INSERT 单行 trigger,会错误
-- 阻止 ON CONFLICT (id) DO UPDATE 的 INSERT 阶段 (VALUES 里若用到
-- (SELECT ... FROM agent.config WHERE id = 1) 会触发 INSERT → trigger 抛错)。
-- 保留 trigger function 注释为历史,但不创建 trigger,避免再次踩坑。
--
-- DROP TRIGGER IF EXISTS config_single_row ON agent.config;  -- no-op
-- DROP FUNCTION IF EXISTS agent.config_single_row_guard();   -- no-op

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION agent.config_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS config_updated_at ON agent.config;
CREATE TRIGGER config_updated_at
  BEFORE UPDATE ON agent.config
  FOR EACH ROW EXECUTE FUNCTION agent.config_set_updated_at();

COMMENT ON TABLE agent.config IS 'Agent 进程配置(base_url/api_key/model/params),单行,API 编辑';
COMMENT ON COLUMN agent.config.encrypted_key IS 'AES-256-GCM 加密的 ANTHROPIC_API_KEY,密钥 = AGENT_CRED_ENCRYPTION_KEY env';

COMMIT;
