-- ============================================================================
-- ops.audit_log — 通用审计日志（append-only）
-- 用于记录 inventory_monthly_summary 等实体的增删改痕迹
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.audit_log (
  log_id        BIGSERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,                 -- e.g. 'inventory_summary'
  entity_key    TEXT NOT NULL,                 -- e.g. 'tamkoko:hz_fuyang:2026-07'
  action        TEXT NOT NULL,                 -- 'upsert' | 'soft_delete'
  actor         TEXT NOT NULL,                 -- username
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_entity
  ON ops.audit_log (entity_type, entity_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_audit_actor
  ON ops.audit_log (actor, created_at DESC);