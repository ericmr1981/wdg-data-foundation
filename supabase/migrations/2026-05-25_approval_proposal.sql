-- supabase/migrations/2026-05-25_approval_proposal.sql
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.approval_proposal (
  proposal_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID        NOT NULL,
  source_file_id      INT         NOT NULL,
  bank_txn_id         BIGINT      NOT NULL,
  brand_code          TEXT        NOT NULL DEFAULT 'yufeng',

  type                TEXT        NOT NULL CHECK (type IN ('type1', 'type2')),
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'executed', 'timeout')),

  -- LLM 推荐（type1）
  llm_lvl1_code         TEXT,
  llm_lvl2_code         TEXT,
  llm_keyword           TEXT,
  llm_match_field       TEXT,
  llm_confidence        TEXT,
  llm_reasoning         TEXT,
  -- LLM 标记（type2）
  llm_missing_fields    TEXT[],

  -- 用户最终决策
  final_lvl1_code       TEXT,
  final_lvl2_code       TEXT,
  final_keyword         TEXT,
  final_match_field     TEXT,
  user_note             TEXT,
  resolved_by           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,

  -- cross-link to settle-batch execution result
  resolution_log_id     BIGINT
);

CREATE INDEX idx_approval_proposal_batch_id   ON ops.approval_proposal(batch_id);
CREATE INDEX idx_approval_proposal_status     ON ops.approval_proposal(status);
CREATE INDEX idx_approval_proposal_source     ON ops.approval_proposal(source_file_id);
CREATE INDEX idx_approval_proposal_brand      ON ops.approval_proposal(brand_code);
CREATE INDEX idx_approval_proposal_created    ON ops.approval_proposal(created_at DESC);