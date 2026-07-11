-- Migration: 给 agent.config 加 jwks_url 字段
-- 用于在 admin 页面配置 JWKS 端点(不再依赖 env)
-- 跑法: psql -h 127.0.0.1 -p 5433 -U agent -d agent_dev -f sql/01a_agent_config_jwks_url.sql

DO $$ BEGIN
  ALTER TABLE agent.config ADD COLUMN jwks_url TEXT;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

COMMENT ON COLUMN agent.config.jwks_url IS 'Portal JWKS 端点,用于 WS/HTTP JWT 验签。优先级: DB > AGENT_JWKS_URL env';
