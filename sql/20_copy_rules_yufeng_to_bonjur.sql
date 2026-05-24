-- 将 yufeng 的匹配规则复制一份给 bonjur
-- 注意：只复制规则内容，不复制 rule_id / created_at / updated_at

insert into bonjur_cfg.bank_rule_map (
  enabled, priority,
  match_field, match_type, match_value,
  match_field2, match_value2,
  direction,
  lvl1, lvl2, note,
  created_at, updated_at
)
select
  enabled, priority,
  match_field, match_type, match_value,
  match_field2, match_value2,
  direction,
  lvl1, lvl2, note,
  now(), now()
from yufeng_cfg.bank_rule_map;
