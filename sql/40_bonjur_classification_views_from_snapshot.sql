-- Bonjur｜L2 snapshot views
-- 目的：将 bonjur_dm.v_bank_txn_classified 切换为读取 snapshot（避免在线全量分类）

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

  s.matched_rule_id,
  s.lvl1_code,
  s.lvl2_code,
  COALESCE(s.classified_source, 'unclassified') AS classified_source,

  COALESCE(l1.lvl1_name, '（未分类）') AS lvl1_name,
  l2.lvl2_name AS lvl2_name,

  t.source_file_id
FROM bonjur_ods.bank_txn t
LEFT JOIN bonjur_dm.bank_txn_classified_snapshot s
  ON s.bank_txn_id = t.id
LEFT JOIN bonjur_cfg.dim_category_lvl1 l1
  ON l1.lvl1_code = s.lvl1_code
LEFT JOIN bonjur_cfg.dim_category_lvl2 l2
  ON l2.lvl1_code = s.lvl1_code AND l2.lvl2_code = s.lvl2_code;
