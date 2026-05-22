-- WDG Data Foundation - Yufeng 分类匹配策略重构 - M1 迁移 SQL
-- 执行日期：2026-03-24
-- 目标：
--   1. 禁用所有 match_field='any' 的规则（保守策略）
--   2. 添加约束禁止未来插入 any 规则
--   3. 为 counterparty_name contains 规则添加长度校验（≥3）

SET statement_timeout = '30s';

-- ==================== Step 1: 禁用所有 any 规则 ====================
-- 保守策略：不自动拆分，先全部禁用，后续人工重建

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count 
    FROM yufeng_cfg.bank_rule_map 
    WHERE match_field = 'any' AND enabled = true;
    
    RAISE NOTICE '将禁用 % 条 match_field=any 的规则（保守策略）', v_count;
    
    UPDATE yufeng_cfg.bank_rule_map 
    SET enabled = false,
        updated_at = now(),
        note = note || ' | 2026-03-24: any 规则禁用（分类策略重构）'
    WHERE match_field = 'any' AND enabled = true;
    
    RAISE NOTICE '已禁用 % 条 any 规则', v_count;
END $$;

-- ==================== Step 2: 添加约束禁止 any ====================
-- 使用 NOT VALID 先不验证历史数据（因为已禁用），只约束未来插入

ALTER TABLE yufeng_cfg.bank_rule_map 
ADD CONSTRAINT chk_bank_rule_map_no_any 
CHECK (match_field != 'any')
NOT VALID;

-- ==================== Step 3: counterparty_name contains 长度校验 ====================
-- 要求：match_field='counterparty_name' AND match_type='contains' 时，match_value 长度≥3

ALTER TABLE yufeng_cfg.bank_rule_map 
ADD CONSTRAINT chk_bank_rule_map_counterparty_min_len 
CHECK (
    NOT (match_field = 'counterparty_name' AND match_type = 'contains' AND LENGTH(match_value) < 3)
)
NOT VALID;

-- ==================== Step 4: 验证与报告 ====================

-- 4.1 规则状态概览
SELECT 
    match_field,
    match_type,
    enabled,
    COUNT(*) as rule_count,
    AVG(priority) as avg_priority
FROM yufeng_cfg.bank_rule_map
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 4.2 被禁用的 any 规则清单（供人工重建参考）
SELECT 
    rule_id,
    match_value,
    direction,
    lvl1_code,
    lvl2_code,
    priority,
    note
FROM yufeng_cfg.bank_rule_map
WHERE match_field = 'any' AND enabled = false
ORDER BY priority;

-- 4.3 约束验证
SELECT 
    conname as constraint_name,
    CASE WHEN convalidated THEN '已验证' ELSE '未验证' END as validated
FROM pg_constraint
WHERE conrelid = 'yufeng_cfg.bank_rule_map'::regclass
  AND conname LIKE 'chk_bank_rule_map%'
ORDER BY conname;

-- ==================== 完成报告 ====================
SELECT 'M1 迁移完成' as status,
       (SELECT COUNT(*) FROM yufeng_cfg.bank_rule_map WHERE enabled = true) as enabled_rules,
       (SELECT COUNT(*) FROM yufeng_cfg.bank_rule_map WHERE match_field = 'any' AND enabled = false) as disabled_any_rules;
