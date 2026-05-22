-- WDG Data Foundation - Yufeng 回归验证 SQL
-- 执行日期：2026-03-24
-- 用途：验证 M1 迁移后的规则状态/覆盖率/冲突检测

-- ==================== 1. 规则状态概览 ====================
SELECT 
    match_field,
    match_type,
    enabled,
    COUNT(*) as rule_count,
    MIN(priority) as min_priority,
    AVG(priority) as avg_priority,
    MAX(priority) as max_priority
FROM yufeng_cfg.bank_rule_map
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- ==================== 2. 覆盖率分析（基于新函数） ====================
-- 2.1 整体覆盖率
SELECT 
    COUNT(*) as total_txns,
    COUNT(*) FILTER (WHERE classified_source = 'rule') as classified_as_rule,
    COUNT(*) FILTER (WHERE classified_source = 'unclassified') as unclassified,
    ROUND(100.0 * COUNT(*) FILTER (WHERE classified_source = 'rule') / NULLIF(COUNT(*), 0), 2) as coverage_pct
FROM yufeng_dm.v_bank_txn_classified_v2;

-- 2.2 按月覆盖率
SELECT 
    DATE_TRUNC('month', txn_time)::DATE as month,
    COUNT(*) as total_txns,
    COUNT(*) FILTER (WHERE classified_source = 'rule') as classified_as_rule,
    ROUND(100.0 * COUNT(*) FILTER (WHERE classified_source = 'rule') / NULLIF(COUNT(*), 0), 2) as coverage_pct
FROM yufeng_dm.v_bank_txn_classified_v2
GROUP BY 1
ORDER BY 1 DESC;

-- ==================== 3. 未分类分析 ====================
-- 3.1 未分类 Top 摘要
SELECT 
    summary,
    COUNT(*) as txn_count,
    SUM(out_amt) as total_out_amt,
    AVG(out_amt) as avg_out_amt
FROM yufeng_dm.v_bank_txn_classified_v2
WHERE classified_source = 'unclassified'
  AND summary IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;

-- 3.2 未分类 Top 对方单位
SELECT 
    counterparty_name,
    COUNT(*) as txn_count,
    SUM(out_amt) as total_out_amt
FROM yufeng_dm.v_bank_txn_classified_v2
WHERE classified_source = 'unclassified'
  AND counterparty_name IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;

-- ==================== 4. 冲突检测 ====================
-- 4.1 同一字段 + 相同匹配值 + 相同优先级的冲突
SELECT 
    match_field,
    match_value,
    priority,
    COUNT(*) as conflict_count,
    STRING_AGG(rule_id::TEXT, ', ') as conflicting_rule_ids
FROM yufeng_cfg.bank_rule_map
WHERE enabled = true
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY 4 DESC;

-- 4.2 可能冲突的规则（相同字段 + 相似匹配值）
SELECT 
    a.rule_id as rule_a,
    b.rule_id as rule_b,
    a.match_field,
    a.match_value as value_a,
    b.match_value as value_b,
    a.priority,
    b.priority
FROM yufeng_cfg.bank_rule_map a
CROSS JOIN yufeng_cfg.bank_rule_map b
WHERE a.enabled = true AND b.enabled = true
  AND a.match_field = b.match_field
  AND a.priority = b.priority
  AND a.rule_id < b.rule_id
  AND (a.match_value ILIKE '%' || b.match_value || '%' OR b.match_value ILIKE '%' || a.match_value || '%')
LIMIT 50;

-- ==================== 5. 约束验证 ====================
SELECT 
    conname as constraint_name,
    CASE WHEN convalidated THEN '已验证' ELSE '未验证' END as validated,
    pg_get_constraintdef(oid) as constraint_def
FROM pg_constraint
WHERE conrelid = 'yufeng_cfg.bank_rule_map'::regclass
  AND conname LIKE 'chk_%'
ORDER BY conname;

-- ==================== 6. 新旧函数对比（如果有旧函数） ====================
-- 注意：如果旧函数 fn_classify_bank_txn 还存在，可以跑这个对比
-- 否则跳过

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'fn_classify_bank_txn' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'yufeng_dm')
    ) THEN
        RAISE NOTICE '旧函数存在，可以对比新旧分类结果';
    ELSE
        RAISE NOTICE '旧函数不存在，跳过新旧对比';
    END IF;
END $$;

-- ==================== 7. 性能检查 ====================
-- 检查分类函数执行时间（抽样 100 条）
SELECT 
    AVG(duration_ms) as avg_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    MIN(duration_ms) as min_duration_ms
FROM (
    SELECT 
        EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000 as duration_ms
    FROM yufeng_dm.v_bank_txn_classified_v2
    LIMIT 100
) sub;

-- ==================== 完成报告 ====================
SELECT '回归验证完成' as status,
       NOW() as check_time;
