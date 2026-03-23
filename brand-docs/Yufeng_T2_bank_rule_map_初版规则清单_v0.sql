-- Yufeng｜bank_rule_map 初版规则清单 v0
-- 目标：优先覆盖“营业收入(in)”的主渠道 + 常见“手续费(out)”等。
-- 说明：first-match wins；priority 越小优先级越高。

insert into yufeng_cfg.bank_rule_map
(enabled, priority, match_field, match_type, match_value, direction, lvl1, lvl2, note)
values
-- 营业收入（in）- 渠道/平台
(true, 10,  'any', 'contains', '美团',   'in',  '营业收入', '美团',   '美团相关回款（附言/摘要含美团）'),
(true, 11,  'any', 'contains', '饿了么', 'in',  '营业收入', '饿了么', '饿了么相关回款'),
(true, 12,  'any', 'contains', '抖音',   'in',  '营业收入', '抖音',   '抖音相关回款'),
(true, 13,  'any', 'contains', '京东',   'in',  '营业收入', '京东',   '京东相关回款'),

-- 营业收入（in）- 支付/结算公司关键词兜底（仍可细分lvl2=其他）
(true, 20,  'any', 'contains', '北京钱袋宝支付技术有限公司', 'in', '营业收入', '美团',     '钱袋宝（常见于美团结算）'),
(true, 21,  'any', 'contains', '浙江网商银行',               'in', '营业收入', '饿了么',   '网商银行（常见于饿了么结算）'),
(true, 22,  'any', 'contains', '上海富友支付服务股份有限公司','in', '营业收入', '其他渠道', '富友（商户结算）'),
(true, 23,  'any', 'contains', '财付通',                     'in', '营业收入', '微信/财付通','财付通/微信侧结算'),

-- 手续费（out）
(true, 110, 'any', 'contains', '手续费', 'out', '手续费', null, '银行/通道手续费'),

-- 税金（out）
(true, 120, 'any', 'contains', '增值税', 'out', '税金', '增值税', '增值税扣款')
;
