-- ============================================================
-- brand_tamkoko_dm 分类快照、override、视图、refresh 函数
-- 结构与 bonjur 一致;函数体内 fn_classify 调用走 tamkoko cfg
-- 依赖: brand_tamkoko_cfg.fn_classify, brand_tamkoko_ods.bank_txn
-- ============================================================

CREATE SCHEMA IF NOT EXISTS brand_tamkoko_dm;
CREATE SCHEMA IF NOT EXISTS brand_tamkoko_ops;

-- dm.bank_txn_classified_snapshot
CREATE TABLE IF NOT EXISTS brand_tamkoko_dm.bank_txn_classified_snapshot (
  bank_txn_id       BIGINT NOT NULL PRIMARY KEY,
  matched_rule_id   BIGINT,
  lvl1_code         TEXT,
  lvl2_code         TEXT,
  classified_source TEXT,                 -- 'rule' / 'override' / 'unclassified'
  source_file_id    INT,
  classified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tamkoko_snapshot_lvl1
  ON brand_tamkoko_dm.bank_txn_classified_snapshot (lvl1_code);
CREATE INDEX IF NOT EXISTS idx_tamkoko_snapshot_source
  ON brand_tamkoko_dm.bank_txn_classified_snapshot (classified_source);

-- dm.bank_txn_override(人工修正,优先级高于 rule)
CREATE TABLE IF NOT EXISTS brand_tamkoko_dm.bank_txn_override (
  bank_txn_id   BIGINT PRIMARY KEY,
  lvl1_code     TEXT NOT NULL,
  lvl2_code     TEXT,
  match_field   TEXT,
  match_value   TEXT,
  created_by    TEXT DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- refresh 函数:全量重刷快照(指定 source_file_id 时只刷该文件)
-- 使用 brand_tamkoko_cfg.fn_classify(txn) 进行分类
CREATE OR REPLACE FUNCTION brand_tamkoko_dm.refresh_bank_txn_classified_snapshot(
  target_source_file_id INT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
BEGIN
  -- 1. 删除目标范围
  IF target_source_file_id IS NOT NULL THEN
    DELETE FROM brand_tamkoko_dm.bank_txn_classified_snapshot
    WHERE source_file_id = target_source_file_id;
  ELSE
    DELETE FROM brand_tamkoko_dm.bank_txn_classified_snapshot;
  END IF;

  -- 2. 重算 + 插入 (使用 LATERAL 调用 fn_classify)
  FOR rec IN
    SELECT
      t.id AS bank_txn_id,
      t.source_file_id,
      t.counterparty_name,
      t.summary,
      t.purpose,
      t.memo
    FROM brand_tamkoko_ods.bank_txn t
    WHERE (target_source_file_id IS NULL OR t.source_file_id = target_source_file_id)
  LOOP
    -- 优先使用 override
    INSERT INTO brand_tamkoko_dm.bank_txn_classified_snapshot (
      bank_txn_id, matched_rule_id, lvl1_code, lvl2_code, classified_source, source_file_id
    )
    SELECT
      rec.bank_txn_id,
      NULL::BIGINT AS matched_rule_id,
      o.lvl1_code,
      o.lvl2_code,
      'override' AS classified_source,
      rec.source_file_id
    FROM brand_tamkoko_dm.bank_txn_override o
    WHERE o.bank_txn_id = rec.bank_txn_id
    ON CONFLICT (bank_txn_id) DO UPDATE SET
      matched_rule_id = EXCLUDED.matched_rule_id,
      lvl1_code = EXCLUDED.lvl1_code,
      lvl2_code = EXCLUDED.lvl2_code,
      classified_source = EXCLUDED.classified_source,
      source_file_id = EXCLUDED.source_file_id;

    -- 如果没有 override，尝试规则匹配
    IF NOT EXISTS (
      SELECT 1 FROM brand_tamkoko_dm.bank_txn_override o
      WHERE o.bank_txn_id = rec.bank_txn_id
    ) THEN
      INSERT INTO brand_tamkoko_dm.bank_txn_classified_snapshot (
        bank_txn_id, matched_rule_id, lvl1_code, lvl2_code, classified_source, source_file_id
      )
      SELECT
        rec.bank_txn_id,
        r.matched_rule_id,
        r.lvl1_code,
        r.lvl2_code,
        CASE WHEN r.matched_rule_id IS NOT NULL THEN 'rule' ELSE 'unclassified' END,
        rec.source_file_id
      FROM brand_tamkoko_cfg.fn_classify(
        rec.counterparty_name,
        rec.summary,
        rec.purpose,
        rec.memo
      ) r
      ON CONFLICT (bank_txn_id) DO UPDATE SET
        matched_rule_id = EXCLUDED.matched_rule_id,
        lvl1_code = EXCLUDED.lvl1_code,
        lvl2_code = EXCLUDED.lvl2_code,
        classified_source = EXCLUDED.classified_source,
        source_file_id = EXCLUDED.source_file_id;
    END IF;
  END LOOP;
END;
$$;

-- dm.v_bank_txn_classified 视图(供 v_cogs_monthly 等 DM 视图使用)
CREATE OR REPLACE VIEW brand_tamkoko_dm.v_bank_txn_classified AS
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
FROM brand_tamkoko_ods.bank_txn t
LEFT JOIN brand_tamkoko_dm.bank_txn_classified_snapshot s ON s.bank_txn_id = t.id
LEFT JOIN brand_tamkoko_cfg.dim_category_lvl1 l1 ON l1.lvl1_code = s.lvl1_code
LEFT JOIN brand_tamkoko_cfg.dim_category_lvl2 l2 ON l2.lvl1_code = s.lvl1_code AND l2.lvl2_code = s.lvl2_code;

-- ops.unclassified_resolution_log
CREATE TABLE IF NOT EXISTS brand_tamkoko_ops.unclassified_resolution_log (
  id              BIGSERIAL PRIMARY KEY,
  bank_txn_id     BIGINT NOT NULL,
  lvl1_code       TEXT NOT NULL,
  lvl2_code       TEXT,
  match_field     TEXT,
  match_value     TEXT,
  resolution_type TEXT NOT NULL DEFAULT 'manual',
  created_by      TEXT DEFAULT 'system',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
