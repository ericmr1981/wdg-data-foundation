-- Yufeng｜CFG DDL（v2：bank_rule_map 使用 lvl1_code/lvl2_code）

CREATE SCHEMA IF NOT EXISTS yufeng_cfg;

-- 规则表：用于把 bank_txn 归类到 lvl1_code/lvl2_code
-- 说明：保留 ALTER ADD COLUMN 以兼容旧库（尽量幂等升级）。
CREATE TABLE IF NOT EXISTS yufeng_cfg.bank_rule_map (
  rule_id      BIGSERIAL PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  priority     INT NOT NULL,

  match_field  TEXT NOT NULL,   -- counterparty_name | summary | memo | purpose
  match_type   TEXT NOT NULL,   -- contains | exact | regex
  match_value  TEXT NOT NULL,

  -- 双条件 AND 匹配（可选）
  match_field2 TEXT,
  match_value2 TEXT,

  direction    TEXT NOT NULL DEFAULT 'any', -- in | out | any

  lvl1_code    TEXT NOT NULL,
  lvl2_code    TEXT,
  note         TEXT,

  created_by   TEXT NOT NULL DEFAULT 'seed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 兼容旧结构：如果旧库是 lvl1/lvl2，这里补齐 code 列（允许 NULL，后续可迁移）
ALTER TABLE yufeng_cfg.bank_rule_map
  ADD COLUMN IF NOT EXISTS lvl1_code TEXT,
  ADD COLUMN IF NOT EXISTS lvl2_code TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS match_field2 TEXT,
  ADD COLUMN IF NOT EXISTS match_value2 TEXT;

-- 索引
CREATE INDEX IF NOT EXISTS idx_yufeng_bank_rule_enabled_priority
  ON yufeng_cfg.bank_rule_map(enabled, priority);

CREATE INDEX IF NOT EXISTS idx_yufeng_bank_rule_match
  ON yufeng_cfg.bank_rule_map(match_field, match_type, match_value)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_yufeng_bank_rule_lvl1_code
  ON yufeng_cfg.bank_rule_map(lvl1_code)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_yufeng_bank_rule_match2
  ON yufeng_cfg.bank_rule_map(match_field2, match_value2)
  WHERE enabled = TRUE AND match_field2 IS NOT NULL;
