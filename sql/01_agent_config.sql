-- agent.config — Agent 运行配置(单行)
-- 储存 base_url / api_key / model / params 等
-- api_key 用 AGENT_CRED_ENCRYPTION_KEY (AES-256-GCM) 加密
--
-- 由 phase-1 合并方案引入: 让 Agent config 走 DB 而不是 env
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
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT,             -- 谁改的(admin user id 或 'seed' / 'env-import')
  CONSTRAINT single_row CHECK (id = 1)
);

-- 单例 trigger: 防止插入第二行
CREATE OR REPLACE FUNCTION agent.config_single_row_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM agent.config) >= 1 THEN
    RAISE EXCEPTION 'agent.config 只能有一行';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS config_single_row ON agent.config;
CREATE TRIGGER config_single_row
  BEFORE INSERT ON agent.config
  FOR EACH ROW EXECUTE FUNCTION agent.config_single_row_guard();

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
