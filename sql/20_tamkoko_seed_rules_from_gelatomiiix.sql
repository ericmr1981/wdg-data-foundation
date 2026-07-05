-- ============================================================
-- tamkoko cfg: create bank_rule_map + copy from gelatomiiix (brand-level rules)
-- Task 6: cfg seed rules
-- ============================================================

-- Step 1: Create tamkoko cfg schema + bank_rule_map table
CREATE SCHEMA IF NOT EXISTS brand_tamkoko_cfg;

CREATE TABLE IF NOT EXISTS brand_tamkoko_cfg.bank_rule_map (
  rule_id       BIGSERIAL PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  priority     INT NOT NULL,

  match_field   TEXT NOT NULL,   -- counterparty_name | summary | memo | purpose
  match_type   TEXT NOT NULL,   -- contains | exact | regex
  match_value  TEXT NOT NULL,

  -- 双条件 AND 匹配（可选）
  match_field2 TEXT,
  match_value2 TEXT,

  direction    TEXT NOT NULL DEFAULT 'any', -- in | out | any

  -- 门店级别规则（NULL = brand-level rule）
  store_code   TEXT,

  lvl1_code    TEXT NOT NULL,
  lvl2_code    TEXT,
  note         TEXT,

  created_by   TEXT NOT NULL DEFAULT 'seed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tamkoko_bank_rule_enabled_priority
  ON brand_tamkoko_cfg.bank_rule_map(enabled, priority);

CREATE INDEX IF NOT EXISTS idx_tamkoko_bank_rule_match
  ON brand_tamkoko_cfg.bank_rule_map(match_field, match_type, match_value)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_tamkoko_bank_rule_lvl1_code
  ON brand_tamkoko_cfg.bank_rule_map(lvl1_code)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_tamkoko_bank_rule_store
  ON brand_tamkoko_cfg.bank_rule_map(store_code)
  WHERE enabled = TRUE AND store_code IS NOT NULL;

-- Step 2: Insert enabled rules from gelatomiiix (brand-level only)
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
WHERE r.enabled = true;
