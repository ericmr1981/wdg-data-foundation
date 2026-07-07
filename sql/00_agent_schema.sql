-- sql/00_agent_schema.sql
-- Agent Service 数据层 (conversations / messages / tasks / task_steps / audit_log)
-- Idempotent — 可重复跑

CREATE SCHEMA IF NOT EXISTS agent;

-- ─── 短期记忆: 会话 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  brand             TEXT,
  channel_id        TEXT NOT NULL,                -- 'web' | 'cron'
  status            TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  title             TEXT NOT NULL DEFAULT '新会话',  -- UI 显示名
  summary           TEXT,                          -- LLM 压缩
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 兼容已建表的 DB
ALTER TABLE agent.conversations ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '新会话';
CREATE INDEX IF NOT EXISTS idx_conv_user_active
  ON agent.conversations(user_id, last_active_at DESC);

-- ─── 短期记忆: 消息 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.messages (
  message_id        BIGSERIAL PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES agent.conversations(conversation_id) ON DELETE CASCADE,
  role              TEXT NOT NULL,                -- 'user' | 'assistant' | 'tool' | 'system'
  content           TEXT NOT NULL,
  tool_calls        JSONB,
  tool_results      JSONB,
  thinking          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_conv
  ON agent.messages(conversation_id, message_id);

-- ─── 任务队列: 任务 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.tasks (
  task_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id    UUID REFERENCES agent.tasks(task_id),
  conversation_id   UUID,
  user_id           TEXT,
  task_type         TEXT NOT NULL,                -- 'weekly_bank_review' | ...
  input             JSONB,
  status            TEXT NOT NULL DEFAULT 'QUEUED',  -- NEW|QUEUED|RUNNING|DONE|FAILED|CANCELLED|PARTIAL
  progress          INT NOT NULL DEFAULT 0,
  result            JSONB,
  error             JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created
  ON agent.tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user
  ON agent.tasks(user_id, created_at DESC);

-- ─── 任务队列: 步骤 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.task_steps (
  step_id           BIGSERIAL PRIMARY KEY,
  task_id           UUID NOT NULL REFERENCES agent.tasks(task_id) ON DELETE CASCADE,
  step_index        INT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|RUNNING|DONE|FAILED|SKIPPED
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  result            JSONB,
  error             JSONB,
  UNIQUE(task_id, step_index)
);

-- ─── 审计 ──────────────────────────────
CREATE TABLE IF NOT EXISTS agent.audit_log (
  log_id            BIGSERIAL PRIMARY KEY,
  user_id           TEXT,
  conversation_id   UUID,
  task_id           UUID,
  action            TEXT NOT NULL,                -- 'llm.call' | 'mcp.call' | 'task.enqueue' | 'error' | ...
  payload           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user
  ON agent.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON agent.audit_log(action, created_at DESC);
