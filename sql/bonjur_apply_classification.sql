-- Bonjur｜分类规则应用 v2（对齐 Yufeng v2 策略）
-- 执行顺序：在字典表 (yufeng_category_dictionary_v1_1.sql) 之后执行

------------------------------------------------------------
-- DM Schema
------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS bonjur_dm;
CREATE SCHEMA IF NOT EXISTS bonjur_ops;

------------------------------------------------------------
-- 人工匹配覆盖表（仅日志，不参与分类）
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bonjur_dm.bank_txn_override (
    id              BIGSERIAL PRIMARY KEY,
    bank_txn_id     BIGINT NOT NULL UNIQUE,
    lvl1_code       TEXT NOT NULL,
    lvl2_code       TEXT,
    note            TEXT,
    created_by      TEXT NOT NULL DEFAULT 'ui',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonjur_override_bank_txn_id ON bonjur_dm.bank_txn_override(bank_txn_id);
CREATE INDEX IF NOT EXISTS idx_bonjur_override_lvl1_code ON bonjur_dm.bank_txn_override(lvl1_code);

------------------------------------------------------------
-- 审计日志表
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bonjur_ops.unclassified_resolution_log (
    id                  BIGSERIAL PRIMARY KEY,
    bank_txn_id         BIGINT NOT NULL,
    selected_lvl1_code  TEXT NOT NULL,
    selected_lvl2_code  TEXT,
    generated_rule_id   BIGINT,
    resolved_by         TEXT NOT NULL DEFAULT 'ui',
    resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonjur_resolve_log_bank_txn_id ON bonjur_ops.unclassified_resolution_log(bank_txn_id);

------------------------------------------------------------
-- 规则沉淀函数（所有参数都有默认值，避免顺序问题）
------------------------------------------------------------
CREATE OR REPLACE FUNCTION bonjur_cfg.settle_rule(
    p_match_field TEXT DEFAULT NULL,
    p_match_value TEXT DEFAULT NULL,
    p_match_type TEXT DEFAULT 'contains',
    p_direction TEXT DEFAULT 'any',
    p_lvl1_code TEXT DEFAULT NULL,
    p_lvl2_code TEXT DEFAULT NULL,
    p_priority INT DEFAULT 100,
    p_enabled BOOLEAN DEFAULT TRUE,
    p_note TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
    v_rule_id BIGINT;
BEGIN
    INSERT INTO bonjur_cfg.bank_rule_map (
        match_field, match_value, match_type, direction,
        lvl1_code, lvl2_code, priority, enabled, note, created_by
    ) VALUES (
        p_match_field, p_match_value, p_match_type, p_direction,
        p_lvl1_code, p_lvl2_code, p_priority, p_enabled, p_note, 'ui'
    )
    ON CONFLICT DO NOTHING
    RETURNING rule_id INTO v_rule_id;

    RETURN v_rule_id;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------
-- 覆盖写回函数
------------------------------------------------------------
CREATE OR REPLACE FUNCTION bonjur_dm.upsert_bank_txn_override(
    p_bank_txn_id BIGINT,
    p_lvl1_code TEXT,
    p_lvl2_code TEXT,
    p_note TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'ui'
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO bonjur_dm.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
    VALUES (p_bank_txn_id, p_lvl1_code, p_lvl2_code, p_note, p_created_by)
    ON CONFLICT (bank_txn_id) DO UPDATE SET
        lvl1_code = EXCLUDED.lvl1_code,
        lvl2_code = EXCLUDED.lvl2_code,
        note = EXCLUDED.note,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bonjur_dm.delete_bank_txn_override(p_bank_txn_id BIGINT)
RETURNS VOID AS $$
BEGIN
    DELETE FROM bonjur_dm.bank_txn_override WHERE bank_txn_id = p_bank_txn_id;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------
-- 分类函数 v2（Bonjur）
------------------------------------------------------------
DROP FUNCTION IF EXISTS bonjur_dm.fn_classify_bank_txn_v2(BIGINT) CASCADE;
DROP TYPE IF EXISTS bonjur_dm.classify_result_v2 CASCADE;

CREATE TYPE bonjur_dm.classify_result_v2 AS (
    matched_rule_id   BIGINT,
    lvl1_code         TEXT,
    lvl2_code         TEXT,
    classified_source TEXT  -- 'rule' | 'unclassified'
);

CREATE OR REPLACE FUNCTION bonjur_dm.fn_classify_bank_txn_v2(p_bank_txn_id BIGINT)
RETURNS bonjur_dm.classify_result_v2
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
    rec RECORD;
BEGIN
    SELECT t.summary, t.memo, t.purpose, t.counterparty_name, t.in_amt, t.out_amt
    INTO v_summary, v_memo, v_purpose, v_counterparty_name, v_in_amt, v_out_amt
    FROM bonjur_ods.bank_txn t
    WHERE t.id = p_bank_txn_id;

    -- Step 1: summary (contains)
    IF v_summary IS NOT NULL AND LENGTH(TRIM(v_summary)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM bonjur_cfg.bank_rule_map r
        WHERE r.enabled = TRUE AND r.match_field = 'summary' AND r.match_type = 'contains'
          AND (r.direction = 'any' OR (r.direction = 'in' AND v_in_amt > 0) OR (r.direction = 'out' AND v_out_amt > 0))
          AND v_summary ILIKE '%' || r.match_value || '%'
        ORDER BY r.priority ASC LIMIT 1;
        IF FOUND THEN RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'); END IF;
    END IF;

    -- Step 2: memo (contains)
    IF v_memo IS NOT NULL AND LENGTH(TRIM(v_memo)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM bonjur_cfg.bank_rule_map r
        WHERE r.enabled = TRUE AND r.match_field = 'memo' AND r.match_type = 'contains'
          AND (r.direction = 'any' OR (r.direction = 'in' AND v_in_amt > 0) OR (r.direction = 'out' AND v_out_amt > 0))
          AND v_memo ILIKE '%' || r.match_value || '%'
        ORDER BY r.priority ASC LIMIT 1;
        IF FOUND THEN RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'); END IF;
    END IF;

    -- Step 3: purpose (contains)
    IF v_purpose IS NOT NULL AND LENGTH(TRIM(v_purpose)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM bonjur_cfg.bank_rule_map r
        WHERE r.enabled = TRUE AND r.match_field = 'purpose' AND r.match_type = 'contains'
          AND (r.direction = 'any' OR (r.direction = 'in' AND v_in_amt > 0) OR (r.direction = 'out' AND v_out_amt > 0))
          AND v_purpose ILIKE '%' || r.match_value || '%'
        ORDER BY r.priority ASC LIMIT 1;
        IF FOUND THEN RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'); END IF;
    END IF;

    -- Step 4: counterparty_name
    IF v_counterparty_name IS NOT NULL AND LENGTH(TRIM(v_counterparty_name)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM bonjur_cfg.bank_rule_map r
        WHERE r.enabled = TRUE AND r.match_field = 'counterparty_name' AND r.match_type = 'contains'
          AND LENGTH(r.match_value) >= 3
          AND (r.direction = 'any' OR (r.direction = 'in' AND v_in_amt > 0) OR (r.direction = 'out' AND v_out_amt > 0))
          AND v_counterparty_name ILIKE '%' || r.match_value || '%'
        ORDER BY r.priority ASC LIMIT 1;
        IF FOUND THEN RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'); END IF;

        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM bonjur_cfg.bank_rule_map r
        WHERE r.enabled = TRUE AND r.match_field = 'counterparty_name' AND r.match_type = 'exact'
          AND (r.direction = 'any' OR (r.direction = 'in' AND v_in_amt > 0) OR (r.direction = 'out' AND v_out_amt > 0))
          AND v_counterparty_name = r.match_value
        ORDER BY r.priority ASC LIMIT 1;
        IF FOUND THEN RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, 'rule'); END IF;
    END IF;

    -- Step 5: unclassified
    RETURN ROW(NULL::BIGINT, NULL::TEXT, NULL::TEXT, 'unclassified'::TEXT);
END;
$function$;

------------------------------------------------------------
-- 分类视图
------------------------------------------------------------
DROP VIEW IF EXISTS bonjur_dm.v_bank_txn_classified_v2 CASCADE;

CREATE VIEW bonjur_dm.v_bank_txn_classified_v2 AS
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
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).matched_rule_id AS matched_rule_id,
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code AS lvl1_code,
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl2_code AS lvl2_code,
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).classified_source AS classified_source,
    COALESCE(l1.lvl1_name, '（未分类）') AS lvl1_name,
    COALESCE(l2.lvl2_name, NULL) AS lvl2_name,
    t.source_file_id
FROM bonjur_ods.bank_txn t
LEFT JOIN yufeng_cfg.dim_category_lvl1 l1 
  ON l1.lvl1_code = (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code
LEFT JOIN yufeng_cfg.dim_category_lvl2 l2 
  ON l2.lvl1_code = (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code
  AND l2.lvl2_code = (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl2_code;

-- 兼容视图
DROP VIEW IF EXISTS bonjur_dm.v_bank_txn_classified CASCADE;
CREATE VIEW bonjur_dm.v_bank_txn_classified AS
SELECT * FROM bonjur_dm.v_bank_txn_classified_v2;
