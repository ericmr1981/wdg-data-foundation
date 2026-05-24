-- gelatomiiix | 银行规则修正 & 收入渠道补全
-- 问题1: 财付通（微信支付）被误分类为 MEITUAN，应为 WECHAT
-- 问题2: 钱袋宝（美团团购）被误分类为 ELEME，应为 MEITUAN
-- 说明: match_field='counterparty_name' 的优先级（数值越小越高）天然高于 summary contains 规则
--       因此只要把 counterparty_name 规则修正即可，summary 规则无需修改

BEGIN;

-- ============================================================
-- 修正 rule_id=512: 财付通 -> WECHAT
-- ============================================================
UPDATE brand_gelatomiiix_cfg.bank_rule_map
SET match_field = 'counterparty_name',
    match_type = 'exact',
    match_value = '财付通支付科技有限公司',
    lvl1_code = 'REV_BIZ',
    lvl2_code = 'WECHAT',
    note = '修正: 财付通=微信支付，非美团',
    priority = 5,
    created_at = now()
WHERE rule_id = 512;

-- ============================================================
-- 修正 rule_id=414: 钱袋宝 -> MEITUAN
-- ============================================================
UPDATE brand_gelatomiiix_cfg.bank_rule_map
SET match_field = 'counterparty_name',
    match_type = 'exact',
    match_value = '北京钱袋宝支付技术有限公司',
    lvl1_code = 'REV_BIZ',
    lvl2_code = 'MEITUAN',
    note = '修正: 钱袋宝=美团团购，非饿了么',
    priority = 5,
    created_at = now()
WHERE rule_id = 414;

-- ============================================================
-- 补全: 支付宝 counterparty_name 规则（优先级 5）
-- 问题: 支付宝的 summary 是"贷记"，会被 DOUYIN 规则误分类
--       需要 counterparty_name 精确匹配来覆盖
-- ============================================================
INSERT INTO brand_gelatomiiix_cfg.bank_rule_map
  (enabled, priority, direction, match_field, match_type, match_value, lvl1_code, lvl2_code, note, created_at)
SELECT
  't', 5, 'in', 'counterparty_name', 'contains', '支付宝',
  'REV_BIZ', 'ALIPAY', '支付宝收入（counterparty_name 优先）', now()
WHERE NOT EXISTS (
    SELECT 1 FROM brand_gelatomiiix_cfg.bank_rule_map
    WHERE match_field = 'counterparty_name' AND match_value = '支付宝' AND direction = 'in'
);

-- ============================================================
-- 补全: 银联云闪付（summary 规则，优先级 10）
-- ============================================================
INSERT INTO brand_gelatomiiix_cfg.bank_rule_map
  (enabled, priority, direction, match_field, match_type, match_value, lvl1_code, lvl2_code, note, created_at)
SELECT
  't', 10, 'in', 'summary', 'contains', '银联',
  'REV_BIZ', 'UNIONPAY', '银联云闪付收入', now()
WHERE NOT EXISTS (
    SELECT 1 FROM brand_gelatomiiix_cfg.bank_rule_map
    WHERE match_field = 'summary' AND match_value = '银联' AND direction = 'in'
);

COMMIT;
