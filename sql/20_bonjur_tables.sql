-- Bonjur 基础表创建（cfg + dm + ops）
CREATE SCHEMA IF NOT EXISTS bonjur_cfg;
CREATE SCHEMA IF NOT EXISTS bonjur_ods;
CREATE SCHEMA IF NOT EXISTS bonjur_dm;
CREATE SCHEMA IF NOT EXISTS bonjur_ops;

-- cfg.bank_rule_map
CREATE TABLE IF NOT EXISTS bonjur_cfg.bank_rule_map (
  rule_id      BIGSERIAL PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  priority     INT NOT NULL,
  match_field  TEXT NOT NULL,
  match_type   TEXT NOT NULL DEFAULT 'contains',
  match_value  TEXT NOT NULL,
  match_field2 TEXT,
  match_value2 TEXT,
  direction    TEXT NOT NULL DEFAULT 'any',
  lvl1_code    TEXT NOT NULL,
  lvl2_code    TEXT,
  lvl1         TEXT,
  lvl2         TEXT,
  note         TEXT,
  created_by   TEXT DEFAULT 'seed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  group_name   TEXT
);

-- cfg.dim_category_lvl1
CREATE TABLE IF NOT EXISTS bonjur_cfg.dim_category_lvl1 (
  lvl1_code   TEXT NOT NULL PRIMARY KEY,
  lvl1_name   TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- cfg.dim_category_lvl2
CREATE TABLE IF NOT EXISTS bonjur_cfg.dim_category_lvl2 (
  lvl1_code   TEXT NOT NULL REFERENCES bonjur_cfg.dim_category_lvl1(lvl1_code),
  lvl2_code   TEXT NOT NULL,
  lvl2_name   TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lvl1_code, lvl2_code)
);

-- cfg.dim_store
CREATE TABLE IF NOT EXISTS bonjur_cfg.dim_store (
  store_code  TEXT NOT NULL PRIMARY KEY,
  store_name  TEXT NOT NULL,
  sort_order  INT DEFAULT 9999
);

-- dm.bank_txn_classified_snapshot
CREATE TABLE IF NOT EXISTS bonjur_dm.bank_txn_classified_snapshot (
  bank_txn_id      BIGINT NOT NULL PRIMARY KEY,
  source_file_id   INT,
  month            DATE,
  matched_rule_id  BIGINT,
  lvl1_code        TEXT,
  lvl2_code        TEXT,
  classified_source TEXT NOT NULL DEFAULT 'unclassified',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- dm.bank_txn_override
CREATE TABLE IF NOT EXISTS bonjur_dm.bank_txn_override (
  id          BIGSERIAL PRIMARY KEY,
  bank_txn_id BIGINT NOT NULL,
  lvl1_code   TEXT NOT NULL,
  lvl2_code   TEXT,
  note        TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  TEXT
);

-- dm.profit_monthly
CREATE TABLE IF NOT EXISTS bonjur_dm.profit_monthly (
  month               DATE NOT NULL,
  store_code          TEXT NOT NULL,
  bank_revenue_amt    NUMERIC DEFAULT 0,
  total_in_amt        NUMERIC DEFAULT 0,
  expense_total_amt   NUMERIC DEFAULT 0,
  expense_ex_build_amt NUMERIC DEFAULT 0,
  material_purchase_amt NUMERIC DEFAULT 0,
  profit_amt          NUMERIC DEFAULT 0,
  cashflow_amt        NUMERIC DEFAULT 0,
  gross_margin_rate   NUMERIC DEFAULT 0,
  PRIMARY KEY (month, store_code)
);

-- dm.revenue_monthly
CREATE TABLE IF NOT EXISTS bonjur_dm.revenue_monthly (
  month              DATE NOT NULL PRIMARY KEY,
  biz_revenue_amt    NUMERIC,
  bank_revenue_amt   NUMERIC DEFAULT 0,
  diff_amt           NUMERIC
);

-- dm.expense_monthly
CREATE TABLE IF NOT EXISTS bonjur_dm.expense_monthly (
  month        DATE NOT NULL,
  lvl1_code    TEXT NOT NULL,
  lvl2_code    TEXT,
  total_out_amt NUMERIC DEFAULT 0,
  txn_rows     BIGINT DEFAULT 0,
  PRIMARY KEY (month, lvl1_code, lvl2_code)
);

-- ods.bank_txn
CREATE TABLE IF NOT EXISTS bonjur_ods.bank_txn (
  id                BIGSERIAL PRIMARY KEY,
  store_code        TEXT,
  txn_time          TIMESTAMP,
  counterparty_name TEXT,
  summary           TEXT,
  memo              TEXT,
  purpose           TEXT,
  in_amt            NUMERIC,
  out_amt           NUMERIC,
  balance_amt       NUMERIC,
  source_file_id    INT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  self_acct         TEXT,
  counterparty_acct TEXT
);

-- dm.v_bank_txn_classified (view needed by financial statement views)
CREATE OR REPLACE VIEW bonjur_dm.v_bank_txn_classified AS
SELECT
  t.id AS bank_txn_id,
  t.store_code,
  t.txn_time,
  t.counterparty_name,
  t.summary,
  t.memo,
  t.purpose,
  t.in_amt,
  t.out_amt,
  t.balance_amt,
  s.matched_rule_id,
  s.lvl1_code,
  s.lvl2_code,
  COALESCE(s.classified_source, 'unclassified') AS classified_source,
  l1.lvl1_name,
  l2.lvl2_name,
  s.source_file_id
FROM bonjur_ods.bank_txn t
LEFT JOIN bonjur_dm.bank_txn_classified_snapshot s ON s.bank_txn_id = t.id
LEFT JOIN bonjur_cfg.dim_category_lvl1 l1 ON l1.lvl1_code = s.lvl1_code
LEFT JOIN bonjur_cfg.dim_category_lvl2 l2 ON l2.lvl1_code = s.lvl1_code AND l2.lvl2_code = s.lvl2_code;

-- ops.unclassified_resolution_log
CREATE TABLE IF NOT EXISTS bonjur_ops.unclassified_resolution_log (
  id              BIGSERIAL PRIMARY KEY,
  bank_txn_id     BIGINT NOT NULL,
  lvl1_code       TEXT NOT NULL,
  lvl2_code       TEXT,
  match_field     TEXT,
  match_value     TEXT,
  resolution_type TEXT NOT NULL DEFAULT 'manual',
  created_by      TEXT DEFAULT 'system',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
