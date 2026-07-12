-- Migration: 给 agent.config 加 mcp_backends 字段
-- 属于 commit: feat(agent): UnifiedMcpBridge 多后端支持
-- 用于在 admin 页面配置外部 MCP 后端（例如 DailyCheck），
-- 不再需要写死在 server.ts 或 env 里。
-- 格式: [{ "name":"dailycheck","url":"http://dailycheck:5100/api/mcp","transport":"fetch","headers":{"Authorization":"Bearer xxx"},"timeoutMs":30000 }]
-- 跑法: psql -h 127.0.0.1 -p 5433 -U agent -d agent_dev -f sql/01b_agent_config_mcp_backends.sql
--    或: bash sql/migrate-all.sh

DO $$ BEGIN
  ALTER TABLE agent.config ADD COLUMN mcp_backends JSONB;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

COMMENT ON COLUMN agent.config.mcp_backends IS '外部 MCP 后端配置 (JSON 数组)。每项: {name,url,transport?,headers?,timeoutMs?}';
