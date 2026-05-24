-- brand_gelatomiiix ODS 层银行流水视图
-- 为银行入账率分析提供统一的 amount/txn_date 字段
-- 注意: bank_txn 表使用 in_amt/out_amt 字段（非 amount）

DROP VIEW IF EXISTS brand_gelatomiiix_ods.v_bank_txn CASCADE;
CREATE VIEW brand_gelatomiiix_ods.v_bank_txn AS
SELECT
  id,
  store_code,
  txn_time,
  txn_time::DATE AS txn_date,
  counterparty_name,
  summary,
  memo,
  purpose,
  COALESCE(in_amt, 0) AS amount,
  COALESCE(out_amt, 0) AS out_amt,
  balance_amt,
  source_file_id,
  created_at
FROM brand_gelatomiiix_ods.bank_txn;