-- yufeng_fix_v_bank_txn_classified_aliases.sql
--
-- Purpose
-- - Ensure yufeng_dm.v_bank_txn_classified exposes BOTH legacy columns (lvl1/lvl2)
--   and explicit aliases (lvl1_name/lvl2_name) used by Metabase cards.
-- - This is a compatibility patch for environments created before v2 view added *_name columns.
--
-- Safe to run multiple times.

-- IMPORTANT:
-- Postgres does NOT allow CREATE OR REPLACE VIEW to rename existing columns.
-- The v2 init creates v_bank_txn_classified as `SELECT * FROM v_bank_txn_classified_v2`,
-- so we must preserve the original column order/names and only APPEND extra columns.

CREATE OR REPLACE VIEW yufeng_dm.v_bank_txn_classified AS
SELECT
  -- v2 columns (keep order stable)
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
  cls.classified_source,

  -- join 字典表获取名称（与 v2 默认口径一致）
  COALESCE(l1.lvl1_name, '（未分类）') AS lvl1_name,
  COALESCE(l2.lvl2_name, NULL) AS lvl2_name,

  t.source_file_id,

  -- legacy display columns (APPEND ONLY)
  COALESCE(l1.lvl1_name, '（未分类）') AS lvl1,
  COALESCE(l2.lvl2_name, NULL) AS lvl2
FROM yufeng_ods.bank_txn t
CROSS JOIN LATERAL yufeng_dm.fn_classify_bank_txn_v2(t.id)
  cls(matched_rule_id, lvl1_code, lvl2_code, classified_source)
LEFT JOIN yufeng_cfg.dim_category_lvl1 l1
  ON l1.lvl1_code = cls.lvl1_code
LEFT JOIN yufeng_cfg.dim_category_lvl2 l2
  ON l2.lvl1_code = cls.lvl1_code
 AND l2.lvl2_code = cls.lvl2_code;
