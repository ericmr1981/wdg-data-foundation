-- Yufeng｜L2 snapshot views
-- 目的：将 yufeng_dm.v_bank_txn_classified 切换为读取 snapshot（避免在线全量分类）

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

  s.matched_rule_id,
  s.lvl1_code,
  s.lvl2_code,

  -- 兼容列（历史上部分 SQL/UI 读取 lvl1/lvl2）
  s.lvl1_code AS lvl1,
  s.lvl2_code AS lvl2,

  COALESCE(s.classified_source, 'unclassified') AS classified_source,
  t.source_file_id,

  -- 展示名称列（字典表 join）
  COALESCE(l1.lvl1_name, '（未分类）') AS lvl1_name,
  l2.lvl2_name AS lvl2_name

FROM yufeng_ods.bank_txn t
LEFT JOIN yufeng_dm.bank_txn_classified_snapshot s
  ON s.bank_txn_id = t.id
LEFT JOIN yufeng_cfg.dim_category_lvl1 l1
  ON l1.lvl1_code = s.lvl1_code
LEFT JOIN yufeng_cfg.dim_category_lvl2 l2
  ON l2.lvl1_code = s.lvl1_code AND l2.lvl2_code = s.lvl2_code;

-- keep debug view name (optional): v_bank_txn_classified_v2 remains function-based
