-- ============================================================================
-- 10_channel_mapping.sql — 品牌渠道映射表
-- 用途：银行入账率分析中，将企迈支付方式（payment_methods）映射到渠道代码
-- 每个品牌在 cfg schema 下维护独立的映射，可在 UI 规则管理中热编辑
-- ============================================================================

-- 新建品牌时，直接为其 cfg schema 创建表并插入默认映射即可。
-- 以下为 gelatomiiix 和 bonjur 的初始映射（其他品牌 bootstrap 时自动创建）。

-- 创建表（幂等）
CREATE TABLE IF NOT EXISTS brand_gelatomiiix_cfg.channel_mapping (
  id BIGSERIAL PRIMARY KEY,
  payment_method TEXT NOT NULL UNIQUE,
  channel_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bonjur_cfg.channel_mapping (
  id BIGSERIAL PRIMARY KEY,
  payment_method TEXT NOT NULL UNIQUE,
  channel_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 默认映射（幂等）
INSERT INTO brand_gelatomiiix_cfg.channel_mapping (payment_method, channel_code, sort_order) VALUES
  ('现金支付',     'CASH',     5),
  ('微信支付',     'WECHAT',  10),
  ('支付宝支付',   'ALIPAY',  20),
  ('美团在线点单', 'MEITUAN', 25),
  ('美团外卖支付', 'MEITUAN', 27),
  ('美团团购券',   'MEITUAN', 30),
  ('云闪付',       'CLOUD_PAY',40),
  ('抖音团购券',   'DOUYIN',  50),
  ('饿了么',       'ELEME',   60),
  ('京东秒送支付', 'JD',      65),
  ('京东支付',     'JD',      70),
  ('淘宝闪购支付', 'TAOBAO',  80)
ON CONFLICT (payment_method) DO NOTHING;

INSERT INTO bonjur_cfg.channel_mapping (payment_method, channel_code, sort_order) VALUES
  ('现金支付',     'CASH',     5),
  ('微信支付',     'WECHAT',  10),
  ('支付宝支付',   'ALIPAY',  20),
  ('美团在线点单', 'MEITUAN', 25),
  ('美团外卖支付', 'MEITUAN', 27),
  ('美团团购券',   'MEITUAN', 30),
  ('云闪付',       'CLOUD_PAY',40),
  ('抖音团购券',   'DOUYIN',  50),
  ('饿了么',       'ELEME',   60),
  ('京东秒送支付', 'JD',      65),
  ('京东支付',     'JD',      70),
  ('淘宝闪购支付', 'TAOBAO',  80)
ON CONFLICT (payment_method) DO NOTHING;
