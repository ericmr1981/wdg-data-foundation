-- ============================================================
-- tamkoko cfg: copy bank_rule_map rules from gelatomiiix (brand-level only)
-- Layer: 20_ods (data seed, not cfg DDL)
-- DDL moved to sql/10_tamkoko_cfg_bank_rule_map_ddl.sql
-- ============================================================

-- Step 1: Insert enabled rules from gelatomiiix (brand-level only)
-- Store-level rules (store_code IS NOT NULL) are NOT copied

INSERT INTO brand_tamkoko_cfg.bank_rule_map (
  enabled,
  priority,
  direction,
  match_field,
  match_type,
  match_value,
  match_field2,
  match_value2,
  store_code,
  lvl1_code,
  lvl2_code,
  note,
  created_by,
  created_at,
  updated_at
)
SELECT
  r.enabled,
  r.priority,
  r.direction,
  r.match_field,
  r.match_type,
  r.match_value,
  r.match_field2,
  r.match_value2,
  NULL AS store_code,  -- brand-level rule
  r.lvl1_code,
  r.lvl2_code,
  COALESCE(r.note, 'seeded from gelatomiiix') AS note,
  'seed' AS created_by,
  NOW() AS created_at,
  NOW() AS updated_at
FROM brand_gelatomiiix_cfg.bank_rule_map r
WHERE r.enabled = true
ON CONFLICT DO NOTHING;

-- Unique index for future ON CONFLICT (match) support
CREATE UNIQUE INDEX IF NOT EXISTS idx_tamkoko_bank_rule_unique_match
  ON brand_tamkoko_cfg.bank_rule_map(match_field, match_type, match_value, COALESCE(store_code, ''), direction);
