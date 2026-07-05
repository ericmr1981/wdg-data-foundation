-- ============================================================
-- brand_tamkoko_cfg.fn_classify(txn)
-- 从 yufeng_fn_classify.sql 整体移植,函数体不变,
-- 只切 search_path 指向 tamkoko schema。规则匹配依赖 cfg.bank_rule_map。
-- ============================================================

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
DECLARE
  v_rule_id  BIGINT;
  v_lvl1     TEXT;
  v_lvl2     TEXT;
  v_field    TEXT;
  v_value    TEXT;
  v_priority INT;
BEGIN
  -- 按优先级遍历规则,匹配即返回
  FOR v_rule_id, v_lvl1, v_lvl2, v_field, v_value, v_priority IN
    SELECT id, lvl1_code, lvl2_code, match_field, match_value, priority
    FROM brand_tamkoko_cfg.bank_rule_map
    WHERE enabled = true
      AND (store_code IS NULL OR store_code = (
        SELECT store_code FROM brand_tamkoko_cfg.dim_store LIMIT 1
      ))
    ORDER BY priority DESC, id ASC
  LOOP
    IF v_field = 'counterparty_name' AND p_counterparty_name ILIKE '%' || v_value || '%' THEN
      matched_rule_id := v_rule_id;
      lvl1_code := v_lvl1;
      lvl2_code := v_lvl2;
      match_field := v_field;
      match_value := v_value;
      priority := v_priority;
      RETURN NEXT;
      RETURN;
    ELSIF v_field = 'summary' AND p_summary ILIKE '%' || v_value || '%' THEN
      matched_rule_id := v_rule_id;
      lvl1_code := v_lvl1;
      lvl2_code := v_lvl2;
      match_field := v_field;
      match_value := v_value;
      priority := v_priority;
      RETURN NEXT;
      RETURN;
    ELSIF v_field = 'purpose' AND p_purpose ILIKE '%' || v_value || '%' THEN
      matched_rule_id := v_rule_id;
      lvl1_code := v_lvl1;
      lvl2_code := v_lvl2;
      match_field := v_field;
      match_value := v_value;
      priority := v_priority;
      RETURN NEXT;
      RETURN;
    ELSIF v_field = 'memo' AND p_memo ILIKE '%' || v_value || '%' THEN
      matched_rule_id := v_rule_id;
      lvl1_code := v_lvl1;
      lvl2_code := v_lvl2;
      match_field := v_field;
      match_value := v_value;
      priority := v_priority;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  -- 未匹配:返回 NULL 行
  RETURN;
END;
$$;

COMMENT ON FUNCTION brand_tamkoko_cfg.fn_classify IS
  '银行流水分类函数(从 yufeng 版移植);匹配 brand_tamkoko_cfg.bank_rule_map 规则';
