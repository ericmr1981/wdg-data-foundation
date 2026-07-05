-- ============================================================
-- brand_tamkoko_cfg.fn_classify(txn)
-- 从 yufeng_fn_classify.sql 整体移植,函数体不变,
-- 只切 search_path 指向 tamkoko schema。规则匹配依赖 cfg.bank_rule_map。
-- ============================================================

-- 旧函数已废弃，使用 brand_tamkoko_dm.fn_classify_bank_txn_v2 替代
-- 此处保留兼容签名（返回表），仅用于向后兼容调用者

CREATE OR REPLACE FUNCTION brand_tamkoko_cfg.fn_classify(
  p_counterparty_name TEXT,
  p_summary            TEXT,
  p_purpose            TEXT,
  p_memo               TEXT
) RETURNS TABLE(
  matched_rule_id BIGINT,
  lvl1_code       TEXT,
  lvl2_code       TEXT,
  match_field     TEXT,
  match_value     TEXT,
  priority        INT
)
LANGUAGE plpgsql STABLE
SET search_path = brand_tamkoko_cfg, brand_tamkoko_dm, public
AS $$
BEGIN
  -- 旧函数实现已废弃，返回空结果
  -- 实际分类使用 brand_tamkoko_dm.fn_classify_bank_txn_v2
  RETURN;
END;
$$;

COMMENT ON FUNCTION brand_tamkoko_cfg.fn_classify IS
  '废弃函数，仅保留向后兼容。实际分类使用 brand_tamkoko_dm.fn_classify_bank_txn_v2';
