-- sql/00_chat_agent_credentials_ddl.sql
-- One row, holds the optional override of the Anthropic API config.
-- If this row exists, it overrides process.env.ANTHROPIC_*. If absent, env is used.

CREATE TABLE IF NOT EXISTS ops.chat_agent_credentials (
  id                  INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_url            TEXT,
  encrypted_api_key   TEXT,
  model               TEXT        NOT NULL DEFAULT 'claude-opus-4-8',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          TEXT
);

CREATE OR REPLACE FUNCTION ops.touch_chat_agent_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_agent_credentials_updated_at ON ops.chat_agent_credentials;
CREATE TRIGGER trg_chat_agent_credentials_updated_at
  BEFORE UPDATE ON ops.chat_agent_credentials
  FOR EACH ROW
  EXECUTE FUNCTION ops.touch_chat_agent_credentials_updated_at();

INSERT INTO ops.chat_agent_credentials (id, model)
  VALUES (1, 'claude-opus-4-8')
  ON CONFLICT (id) DO NOTHING;
