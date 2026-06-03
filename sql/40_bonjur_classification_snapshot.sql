-- Bonjur｜L2 snapshot：分类结果落表（避免在线 view 触发全量分类）
-- 依赖：bonjur_dm.fn_classify_bank_txn_v2, bonjur_ods.bank_txn

CREATE SCHEMA IF NOT EXISTS bonjur_dm;

CREATE TABLE IF NOT EXISTS bonjur_dm.bank_txn_classified_snapshot (
  bank_txn_id       BIGINT PRIMARY KEY,
  source_file_id    INT,
  month             DATE,

  matched_rule_id   BIGINT,
  lvl1_code         TEXT,
  lvl2_code         TEXT,
  classified_source TEXT NOT NULL,

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bonjur_classified_snapshot_month_src
  ON bonjur_dm.bank_txn_classified_snapshot(month, classified_source);

CREATE INDEX IF NOT EXISTS idx_bonjur_classified_snapshot_source_file
  ON bonjur_dm.bank_txn_classified_snapshot(source_file_id);

-- 增量刷新：按 source_file_id（上传文件）或全量
CREATE OR REPLACE FUNCTION bonjur_dm.refresh_bank_txn_classified_snapshot(p_source_file_id INT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO bonjur_dm.bank_txn_classified_snapshot(
    bank_txn_id,
    source_file_id,
    month,
    matched_rule_id,
    lvl1_code,
    lvl2_code,
    classified_source,
    updated_at
  )
  SELECT
    t.id AS bank_txn_id,
    t.source_file_id,
    date_trunc('month', t.txn_time)::date AS month,
    r.matched_rule_id,
    r.lvl1_code,
    r.lvl2_code,
    r.classified_source,
    now() AS updated_at
  FROM bonjur_ods.bank_txn t
  CROSS JOIN LATERAL bonjur_dm.fn_classify_bank_txn_v2(t.id) r
  WHERE (p_source_file_id IS NULL OR t.source_file_id = p_source_file_id)
  ON CONFLICT (bank_txn_id) DO UPDATE SET
    source_file_id = EXCLUDED.source_file_id,
    month = EXCLUDED.month,
    matched_rule_id = EXCLUDED.matched_rule_id,
    lvl1_code = EXCLUDED.lvl1_code,
    lvl2_code = EXCLUDED.lvl2_code,
    classified_source = EXCLUDED.classified_source,
    updated_at = now();

  -- 标记负金额（冲账/对冲）记录为 ignore
  UPDATE bonjur_dm.bank_txn_classified_snapshot c
  SET classified_source = 'ignore'
  FROM bonjur_ods.bank_txn t
  WHERE c.bank_txn_id = t.id
    AND (t.in_amt < 0 OR t.out_amt < 0)
    AND c.classified_source NOT IN ('override', 'ignore');

  -- 同时标记对应的正金额记录（同门店+同对手+同文件+绝对值相同）
  UPDATE bonjur_dm.bank_txn_classified_snapshot c
  SET classified_source = 'ignore'
  FROM bonjur_ods.bank_txn t
  WHERE c.bank_txn_id = t.id
    AND c.classified_source NOT IN ('override', 'ignore')
    AND EXISTS (
      SELECT 1 FROM bonjur_ods.bank_txn n
      WHERE n.id != t.id
        AND n.store_code = t.store_code
        AND n.counterparty_name IS NOT DISTINCT FROM t.counterparty_name
        AND n.source_file_id = t.source_file_id
        AND (n.in_amt < 0 OR n.out_amt < 0)
        AND (
          (ABS(COALESCE(n.in_amt, 0)) = COALESCE(t.in_amt, 0) AND COALESCE(t.in_amt, 0) > 0)
          OR (ABS(COALESCE(n.out_amt, 0)) = COALESCE(t.out_amt, 0) AND COALESCE(t.out_amt, 0) > 0)
        )
    );
END;
$$;

-- 初始化建议：首次上线后执行一次全量刷新
-- SELECT bonjur_dm.refresh_bank_txn_classified_snapshot(NULL);
