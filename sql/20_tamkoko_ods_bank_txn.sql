-- ============================================================
-- brand_tamkoko_ods.bank_txn 银行流水 ODS
-- 字段与 bonjur / yufeng 完全一致 — 同一份 import_yufeng_bank_txn.py
-- 写入路径对所有品牌通用(get_ods_schema(brand) 派发)
-- 幂等:导入脚本 DELETE WHERE source_file_id=? 再 INSERT
-- ============================================================

CREATE SCHEMA IF NOT EXISTS brand_tamkoko_ods;

CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.bank_txn (
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

CREATE INDEX IF NOT EXISTS idx_tamkoko_bank_txn_store_time
  ON brand_tamkoko_ods.bank_txn (store_code, txn_time);
CREATE INDEX IF NOT EXISTS idx_tamkoko_bank_txn_source_file
  ON brand_tamkoko_ods.bank_txn (source_file_id);
