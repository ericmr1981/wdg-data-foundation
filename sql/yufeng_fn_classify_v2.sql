-- WDG Data Foundation - Yufeng 新分类函数 v2
-- 执行日期：2026-03-24
-- 变更：
--   1. 移除 override 读取（override 仅日志/审计，不参与分类）
--   2. 按字段策略匹配：summary→memo→purpose (contains)；三者空才 counterparty (contains 优先 exact)
--   3. 同字段内 priority asc 取 first match

-- ==================== 返回类型定义 ====================
DROP TYPE IF EXISTS yufeng_dm.classify_result_v2 CASCADE;

CREATE TYPE yufeng_dm.classify_result_v2 AS (
    matched_rule_id BIGINT,
    lvl1_code TEXT,
    lvl2_code TEXT,
    classified_source TEXT  -- 'rule' | 'unclassified'
);

-- ==================== 新分类函数 ====================
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
    -- 获取原始流水字段
    SELECT
        t.summary,
        t.memo,
        t.purpose,
        t.counterparty_name,
        t.in_amt,
        t.out_amt
    INTO 
        v_summary, v_memo, v_purpose, v_counterparty_name, v_in_amt, v_out_amt
    FROM yufeng_ods.bank_txn t
    WHERE t.id = p_bank_txn_id;
    
    -- ==================== Step 1: summary 字段匹配（contains） ====================
    IF v_summary IS NOT NULL AND LENGTH(TRIM(v_summary)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM yufeng_cfg.bank_rule_map r
        WHERE r.enabled = true
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
            v_classified_source := 'rule';
            RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
        END IF;
    END IF;
    
    -- ==================== Step 2: memo 字段匹配（contains） ====================
    IF v_memo IS NOT NULL AND LENGTH(TRIM(v_memo)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM yufeng_cfg.bank_rule_map r
        WHERE r.enabled = true
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
            v_classified_source := 'rule';
            RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
        END IF;
    END IF;
    
    -- ==================== Step 3: purpose 字段匹配（contains） ====================
    IF v_purpose IS NOT NULL AND LENGTH(TRIM(v_purpose)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM yufeng_cfg.bank_rule_map r
        WHERE r.enabled = true
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
            v_classified_source := 'rule';
            RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
        END IF;
    END IF;
    
    -- ==================== Step 4: counterparty_name 兜底 ====================
    -- 仅当 summary/memo/purpose 都为空时才使用
    IF v_counterparty_name IS NOT NULL AND LENGTH(TRIM(v_counterparty_name)) > 0 THEN
        -- 4a: 先试 contains（优先）
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM yufeng_cfg.bank_rule_map r
        WHERE r.enabled = true
          AND r.match_field = 'counterparty_name'
          AND r.match_type = 'contains'
          AND LENGTH(r.match_value) >= 3  -- 长度约束
          AND (
              r.direction = 'any'
              OR (r.direction = 'in' AND v_in_amt IS NOT NULL AND v_in_amt > 0)
              OR (r.direction = 'out' AND v_out_amt IS NOT NULL AND v_out_amt > 0)
          )
          AND v_counterparty_name ILIKE '%' || r.match_value || '%'
        ORDER BY r.priority ASC
        LIMIT 1;
        
        IF FOUND THEN
            v_classified_source := 'rule';
            RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
        END IF;
        
        -- 4b: 再试 exact（兜底）
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM yufeng_cfg.bank_rule_map r
        WHERE r.enabled = true
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
            v_classified_source := 'rule';
            RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
        END IF;
    END IF;
    
    -- ==================== Step 5: 未分类兜底 ====================
    v_rule_id := NULL;
    v_lvl1_code := 'UNCLASSIFIED';
    v_lvl2_code := NULL;
    v_classified_source := 'unclassified';
    RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
END;
$function$;

-- ==================== 创建兼容视图（使用新函数） ====================
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
    t.source_file_id
FROM yufeng_ods.bank_txn t;

-- ==================== 验证 ====================
SELECT '新函数创建完成' as status,
       (SELECT COUNT(*) FROM yufeng_ods.bank_txn) as total_txns,
       (SELECT COUNT(*) FROM yufeng_dm.v_bank_txn_classified_v2 WHERE classified_source = 'rule') as classified_as_rule,
       (SELECT COUNT(*) FROM yufeng_dm.v_bank_txn_classified_v2 WHERE classified_source = 'unclassified') as unclassified;
