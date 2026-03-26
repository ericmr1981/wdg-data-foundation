-- yufeng_fix_v_bank_txn_classified_aliases.sql
--
-- Purpose
-- - Ensure yufeng_dm.v_bank_txn_classified exposes BOTH legacy columns (lvl1/lvl2)
--   and explicit aliases (lvl1_name/lvl2_name) used by Metabase cards.
-- - This is a compatibility patch for environments created before v2 view added *_name columns.
--
-- Safe to run multiple times.

CREATE OR REPLACE VIEW yufeng_dm.v_bank_txn_classified AS
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

  cls.matched_rule_id,
  cls.lvl1_code,
  cls.lvl2_code,

  -- legacy display columns
  COALESCE(l1.lvl1_name, '未分类') AS lvl1,
  l2.lvl2_name AS lvl2,

  cls.classified_source,
  t.source_file_id,

  -- explicit aliases
  COALESCE(l1.lvl1_name, '未分类') AS lvl1_name,
  l2.lvl2_name AS lvl2_name
FROM yufeng_ods.bank_txn t
CROSS JOIN LATERAL yufeng_dm.fn_classify_bank_txn_v2(t.id)
  cls(matched_rule_id, lvl1_code, lvl2_code, classified_source)
LEFT JOIN yufeng_cfg.dim_category_lvl1 l1
  ON l1.lvl1_code = cls.lvl1_code
LEFT JOIN yufeng_cfg.dim_category_lvl2 l2
  ON l2.lvl1_code = cls.lvl1_code
 AND l2.lvl2_code = cls.lvl2_code;
