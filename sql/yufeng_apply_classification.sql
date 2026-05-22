-- Yufeng｜分类规则应用 v2（lvl1_code/lvl2_code 口径）
-- 执行顺序：在字典表 (yufeng_category_dictionary_v1_1.sql) 之后执行
-- 依赖：yufeng_cfg.dim_category_lvl1, yufeng_cfg.dim_category_lvl2

------------------------------------------------------------
-- ODS: bank_txn（银行流水表）
------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS yufeng_ods;

CREATE TABLE IF NOT EXISTS yufeng_ods.bank_txn (
  id                BIGSERIAL PRIMARY KEY,
  store_code        TEXT NOT NULL DEFAULT 'yf_gh',
  txn_time          TIMESTAMPTZ,
  counterparty_name TEXT,
  summary           TEXT,
  memo              TEXT,
  purpose           TEXT,
  in_amt            NUMERIC(18,2) DEFAULT 0,
  out_amt           NUMERIC(18,2) DEFAULT 0,
  balance_amt       NUMERIC(18,2),
  source_file_id    BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yufeng_bank_txn_time ON yufeng_ods.bank_txn(txn_time);
CREATE INDEX IF NOT EXISTS idx_yufeng_bank_txn_store_time ON yufeng_ods.bank_txn(store_code, txn_time);
CREATE INDEX IF NOT EXISTS idx_yufeng_bank_txn_counterparty ON yufeng_ods.bank_txn(counterparty_name);

------------------------------------------------------------
-- DM: bank_txn_override（人工覆盖表，仅审计不参与分类）
------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS yufeng_dm;

CREATE TABLE IF NOT EXISTS yufeng_dm.bank_txn_override (
  id              BIGSERIAL PRIMARY KEY,
  bank_txn_id     BIGINT NOT NULL UNIQUE,
  lvl1_code       TEXT NOT NULL,
  lvl2_code       TEXT,
  note            TEXT,
  created_by      TEXT NOT NULL DEFAULT 'ui',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yufeng_override_bank_txn_id ON yufeng_dm.bank_txn_override(bank_txn_id);
CREATE INDEX IF NOT EXISTS idx_yufeng_override_lvl1_code ON yufeng_dm.bank_txn_override(lvl1_code);

------------------------------------------------------------
-- 审计日志表
------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS yufeng_ops;

CREATE TABLE IF NOT EXISTS yufeng_ops.unclassified_resolution_log (
  id                  BIGSERIAL PRIMARY KEY,
  bank_txn_id         BIGINT NOT NULL,
  selected_lvl1_code  TEXT NOT NULL,
  selected_lvl2_code  TEXT,
  generated_rule_id   BIGINT,
  resolved_by         TEXT NOT NULL DEFAULT 'ui',
  resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yufeng_resolve_log_bank_txn_id ON yufeng_ops.unclassified_resolution_log(bank_txn_id);

------------------------------------------------------------
-- 分类函数 v2（返回 code）
------------------------------------------------------------
DROP FUNCTION IF EXISTS yufeng_dm.fn_classify_bank_txn_v2(BIGINT) CASCADE;
DROP TYPE IF EXISTS yufeng_dm.classify_result_v2 CASCADE;

CREATE TYPE yufeng_dm.classify_result_v2 AS (
  matched_rule_id   BIGINT,
  lvl1_code         TEXT,
  lvl2_code         TEXT,
  classified_source TEXT  -- 'rule' | 'unclassified'
);

CREATE OR REPLACE FUNCTION yufeng_dm.fn_classify_bank_txn_v2(p_bank_txn_id BIGINT)
RETURNS yufeng_dm.classify_result_v2
LANGUAGE plpgsql
AS $function$
DECLARE
  v_summary TEXT;
  v_memo TEXT;
  v_purpose TEXT;
  v_counterparty_name TEXT;
  v_in_amt NUMERIC;
  v_out_amt NUMERIC;
  
  v_rule_id BIGINT;
  v_lvl1_code TEXT;
  v_lvl2_code TEXT;
  v_classified_source TEXT;
  
  rec RECORD;
BEGIN
  SELECT t.summary, t.memo, t.purpose, t.counterparty_name, t.in_amt, t.out_amt
  INTO v_summary, v_memo, v_purpose, v_counterparty_name, v_in_amt, v_out_amt
  FROM yufeng_ods.bank_txn t
  WHERE t.id = p_bank_txn_id;

  -- Step 1: summary (contains)
  IF v_summary IS NOT NULL AND LENGTH(TRIM(v_summary)) > 0 THEN
    SELECT r.rule_id, r.lvl1_code, r.lvl2_code
    INTO v_rule_id, v_lvl1_code, v_lvl2_code
    FROM yufeng_cfg.bank_rule_map r
    WHERE r.enabled = TRUE
      AND r.match_field = 'summary'
      AND r.match_type = 'contains'
      AND (
        r.direction = 'any'
        OR (r.direction = 'in' AND v_in_amt IS NOT NULL AND v_in_amt > 0)
        OR (r.direction = 'out' AND v_out_amt IS NOT NULL AND v_out_amt > 0)
      )
      AND v_summary ILIKE '%' || r.match_value || '%'
    ORDER BY r.priority ASC
    LIMIT 1;
    
    IF FOUND THEN
      RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'::TEXT);
    END IF;
  END IF;

  -- Step 2: memo (contains)
  IF v_memo IS NOT NULL AND LENGTH(TRIM(v_memo)) > 0 THEN
    SELECT r.rule_id, r.lvl1_code, r.lvl2_code
    INTO v_rule_id, v_lvl1_code, v_lvl2_code
    FROM yufeng_cfg.bank_rule_map r
    WHERE r.enabled = TRUE
      AND r.match_field = 'memo'
      AND r.match_type = 'contains'
      AND (
        r.direction = 'any'
        OR (r.direction = 'in' AND v_in_amt IS NOT NULL AND v_in_amt > 0)
        OR (r.direction = 'out' AND v_out_amt IS NOT NULL AND v_out_amt > 0)
      )
      AND v_memo ILIKE '%' || r.match_value || '%'
    ORDER BY r.priority ASC
    LIMIT 1;
    
    IF FOUND THEN
      RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'::TEXT);
    END IF;
  END IF;

  -- Step 3: purpose (contains)
  IF v_purpose IS NOT NULL AND LENGTH(TRIM(v_purpose)) > 0 THEN
    SELECT r.rule_id, r.lvl1_code, r.lvl2_code
    INTO v_rule_id, v_lvl1_code, v_lvl2_code
    FROM yufeng_cfg.bank_rule_map r
    WHERE r.enabled = TRUE
      AND r.match_field = 'purpose'
      AND r.match_type = 'contains'
      AND (
        r.direction = 'any'
        OR (r.direction = 'in' AND v_in_amt IS NOT NULL AND v_in_amt > 0)
        OR (r.direction = 'out' AND v_out_amt IS NOT NULL AND v_out_amt > 0)
      )
      AND v_purpose ILIKE '%' || r.match_value || '%'
    ORDER BY r.priority ASC
    LIMIT 1;
    
    IF FOUND THEN
      RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'::TEXT);
    END IF;
  END IF;

  -- Step 4: counterparty_name (contains -> exact)
  IF v_counterparty_name IS NOT NULL AND LENGTH(TRIM(v_counterparty_name)) > 0 THEN
    -- 4a: contains
    SELECT r.rule_id, r.lvl1_code, r.lvl2_code
    INTO v_rule_id, v_lvl1_code, v_lvl2_code
    FROM yufeng_cfg.bank_rule_map r
    WHERE r.enabled = TRUE
      AND r.match_field = 'counterparty_name'
      AND r.match_type = 'contains'
      AND LENGTH(r.match_value) >= 3
      AND (
        r.direction = 'any'
        OR (r.direction = 'in' AND v_in_amt IS NOT NULL AND v_in_amt > 0)
        OR (r.direction = 'out' AND v_out_amt IS NOT NULL AND v_out_amt > 0)
      )
      AND v_counterparty_name ILIKE '%' || r.match_value || '%'
    ORDER BY r.priority ASC
    LIMIT 1;
    
    IF FOUND THEN
      RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'::TEXT);
    END IF;
    
    -- 4b: exact
    SELECT r.rule_id, r.lvl1_code, r.lvl2_code
    INTO v_rule_id, v_lvl1_code, v_lvl2_code
    FROM yufeng_cfg.bank_rule_map r
    WHERE r.enabled = TRUE
      AND r.match_field = 'counterparty_name'
      AND r.match_type = 'exact'
      AND (
        r.direction = 'any'
        OR (r.direction = 'in' AND v_in_amt IS NOT NULL AND v_in_amt > 0)
        OR (r.direction = 'out' AND v_out_amt IS NOT NULL AND v_out_amt > 0)
      )
      AND v_counterparty_name = r.match_value
    ORDER BY r.priority ASC
    LIMIT 1;
    
    IF FOUND THEN
      RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'::TEXT);
    END IF;
  END IF;

  -- Step 5: unclassified
  RETURN ROW(NULL::BIGINT, NULL::TEXT, NULL::TEXT, 'unclassified'::TEXT);
END;
$function$;

------------------------------------------------------------
-- 分类视图（v2 + 兼容视图）
------------------------------------------------------------
DROP VIEW IF EXISTS yufeng_dm.v_bank_txn_classified_v2 CASCADE;

CREATE VIEW yufeng_dm.v_bank_txn_classified_v2 AS
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
  (yufeng_dm.fn_classify_bank_txn_v2(t.id)).matched_rule_id AS matched_rule_id,
  (yufeng_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code AS lvl1_code,
  (yufeng_dm.fn_classify_bank_txn_v2(t.id)).lvl2_code AS lvl2_code,
  (yufeng_dm.fn_classify_bank_txn_v2(t.id)).classified_source AS classified_source,
  -- join 字典表获取名称
  COALESCE(l1.lvl1_name, '（未分类）') AS lvl1_name,
  COALESCE(l2.lvl2_name, NULL) AS lvl2_name,
  t.source_file_id
FROM yufeng_ods.bank_txn t
LEFT JOIN yufeng_cfg.dim_category_lvl1 l1 
  ON l1.lvl1_code = (yufeng_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code
LEFT JOIN yufeng_cfg.dim_category_lvl2 l2 
  ON l2.lvl1_code = (yufeng_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code
  AND l2.lvl2_code = (yufeng_dm.fn_classify_bank_txn_v2(t.id)).lvl2_code;

-- 兼容视图（给旧代码用）
DROP VIEW IF EXISTS yufeng_dm.v_bank_txn_classified CASCADE;
CREATE VIEW yufeng_dm.v_bank_txn_classified AS
SELECT * FROM yufeng_dm.v_bank_txn_classified_v2;

------------------------------------------------------------
-- 初版规则种子（示例）
------------------------------------------------------------
INSERT INTO yufeng_cfg.bank_rule_map (enabled, priority, match_field, match_type, match_value, direction, lvl1_code, lvl2_code, note)
VALUES
  (TRUE, 10, 'summary', 'contains', '美团', 'in', 'REV_BIZ', 'MEITUAN', '美团收入'),
  (TRUE, 10, 'summary', 'contains', '饿了么', 'in', 'REV_BIZ', 'ELEME', '饿了么收入'),
  (TRUE, 10, 'summary', 'contains', '抖音', 'in', 'REV_BIZ', 'DOUYIN', '抖音收入'),
  (TRUE, 20, 'summary', 'contains', '手续费', 'out', 'ADMIN', 'BANK_FEE', '银行手续费'),
  (TRUE, 30, 'summary', 'contains', '工资', 'out', 'HR', 'SALARY', '员工工资'),
  (TRUE, 30, 'summary', 'contains', '社保', 'out', 'HR', 'SS', '社保缴纳'),
  (TRUE, 40, 'summary', 'contains', '租金', 'out', 'RENT_UTIL', 'RENT', '店铺租金'),
  (TRUE, 50, 'summary', 'contains', '物业', 'out', 'RENT_UTIL', 'PROP', '物业费'),
  (TRUE, 60, 'summary', 'contains', '水电', 'out', 'RENT_UTIL', 'WATER_ELEC', '水电费'),
  (TRUE, 70, 'summary', 'contains', '材料', 'out', 'MATERIAL', 'RAW', '原材料采购'),
  (TRUE, 80, 'summary', 'contains', '营建', 'out', 'BUILD', 'ENG_FEE', '营建工程款'),
  (TRUE, 90, 'summary', 'contains', '广告', 'out', 'MKT', 'ADS', '广告费'),
  (TRUE, 90, 'summary', 'contains', '礼品', 'out', 'MKT', 'GIFT', '礼品费')
ON CONFLICT DO NOTHING;
