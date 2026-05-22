-- yufeng_rule_map_v2.sql
-- 目的：支持“冲突时双重匹配（摘要 AND 对方单位）”
-- 说明：在不破坏旧规则的前提下，为规则表增加第二条件字段。

ALTER TABLE yufeng_cfg.bank_rule_map
  ADD COLUMN IF NOT EXISTS match_field2 text,
  ADD COLUMN IF NOT EXISTS match_value2 text;

-- 可选：提高双条件命中/冲突检测性能
CREATE INDEX IF NOT EXISTS idx_bank_rule_map_match2
  ON yufeng_cfg.bank_rule_map (match_field2, match_value2)
  WHERE enabled = true AND match_field2 IS NOT NULL;
