-- Rule groups registry (B)

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.rule_groups (
  brand_code  TEXT NOT NULL,
  group_name  TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 9999,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_code, group_name)
);

CREATE INDEX IF NOT EXISTS idx_rule_groups_brand_order
  ON ops.rule_groups(brand_code, sort_order, group_name);
