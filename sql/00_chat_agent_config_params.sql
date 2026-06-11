-- sql/00_chat_agent_config_params.sql
-- Migration: add params JSONB column to persist all agent config params
-- (temperature, maxTokens, thinkingLevel, etc.) across restarts.

ALTER TABLE ops.chat_agent_credentials
  ADD COLUMN IF NOT EXISTS params JSONB;
