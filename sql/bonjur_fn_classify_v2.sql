-- Bonjur 分类函数升级 v2
-- 执行日期：2026-03-25
-- 变更：对齐 Yufeng v2 策略
--   1. 移除 override 参与分类（override 仅日志）
--   2. 按字段策略匹配：summary→memo→purpose (contains)；三者空才 counterparty (contains/exact)
--   3. 共享 yufeng_cfg 字典（lvl1_code/lvl2_code）
--   4. 同字段内 priority asc 取 first match

-- ==================== 返回类型定义 ====================
DROP TYPE IF EXISTS bonjur_dm.classify_result_v2 CASCADE;

CREATE TYPE bonjur_dm.classify_result_v2 AS (
    matched_rule_id BIGINT,
    lvl1_code TEXT,
    lvl2_code TEXT,
    classified_source TEXT  -- 'rule' | 'unclassified'
);

-- ==================== 新分类函数 ====================
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
    FROM bonjur_ods.bank_txn t
    WHERE t.id = p_bank_txn_id;
    
    -- ==================== Step 1: summary 字段匹配（contains） ====================
    IF v_summary IS NOT NULL AND LENGTH(TRIM(v_summary)) > 0 THEN
        SELECT r.rule_id, r.lvl1_code, r.lvl2_code
        INTO v_rule_id, v_lvl1_code, v_lvl2_code
        FROM bonjur_cfg.bank_rule_map r
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
        FROM bonjur_cfg.bank_rule_map r
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
        FROM bonjur_cfg.bank_rule_map r
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
        FROM bonjur_cfg.bank_rule_map r
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
        FROM bonjur_cfg.bank_rule_map r
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
    v_lvl1_code := NULL;
    v_lvl2_code := NULL;
    v_classified_source := 'unclassified';
    RETURN ROW(v_rule_id, v_lvl1_code, v_lvl2_code, v_classified_source);
END;
$function$;

-- ==================== 创建 v2 视图（带字典名称 join） ====================
-- 性能关键：只调用一次 fn_classify_bank_txn_v2（用 LATERAL），避免每行重复执行 3-4 次导致雪崩。
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
    r.matched_rule_id,
    r.lvl1_code,
    r.lvl2_code,
    r.classified_source,
    COALESCE(c1.lvl1_name, '（未分类）') AS lvl1_name,
    COALESCE(c2.lvl2_name, NULL) AS lvl2_name,
    t.source_file_id
FROM bonjur_ods.bank_txn t
CROSS JOIN LATERAL bonjur_dm.fn_classify_bank_txn_v2(t.id) r
LEFT JOIN bonjur_cfg.dim_category_lvl1 c1
    ON c1.lvl1_code = r.lvl1_code
LEFT JOIN bonjur_cfg.dim_category_lvl2 c2
    ON c2.lvl1_code = r.lvl1_code
    AND c2.lvl2_code = r.lvl2_code;

-- ==================== 验证 ====================
SELECT 'Bonjur v2 分类函数创建完成' as status,
       (SELECT COUNT(*) FROM bonjur_ods.bank_txn) as total_txns,
       (SELECT COUNT(*) FROM bonjur_dm.v_bank_txn_classified_v2 WHERE classified_source = 'rule') as classified_as_rule,
       (SELECT COUNT(*) FROM bonjur_dm.v_bank_txn_classified_v2 WHERE classified_source = 'unclassified') as unclassified;