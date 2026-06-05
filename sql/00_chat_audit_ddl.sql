-- sql/00_chat_audit_ddl.sql
-- AI chat widget audit tables. Per spec §9.

CREATE TABLE IF NOT EXISTS ops.chat_session_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT        NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  message_count   INT         NOT NULL DEFAULT 0,
  tool_call_count INT         NOT NULL DEFAULT 0,
  input_tokens    INT         NOT NULL DEFAULT 0,
  output_tokens   INT         NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,4) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ops.chat_tool_call (
  id                  BIGSERIAL PRIMARY KEY,
  session_id          BIGINT       NOT NULL REFERENCES ops.chat_session_log(id) ON DELETE RESTRICT,
  tool_name           TEXT         NOT NULL,
  tool_input          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  tool_result_summary TEXT,
  is_error            BOOLEAN      NOT NULL DEFAULT FALSE,
  duration_ms         INT,
  called_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_tool_call_session ON ops.chat_tool_call(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_log_user  ON ops.chat_session_log(user_id);
