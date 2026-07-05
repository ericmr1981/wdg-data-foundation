-- ============================================================
-- brand_tamkoko_cfg.dim_category_lvl1 / dim_category_lvl2
-- 字段与种子数据从 yufeng_category_dictionary.sql 整体复制,
-- 仅替换 schema 前缀。后续运营可在 UI 重写。
-- ============================================================

CREATE SCHEMA IF NOT EXISTS brand_tamkoko_cfg;

CREATE TABLE IF NOT EXISTS brand_tamkoko_cfg.dim_category_lvl1 (
    lvl1_code TEXT PRIMARY KEY,
    lvl1_name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brand_tamkoko_cfg.dim_category_lvl2 (
    lvl1_code TEXT NOT NULL,
    lvl2_code TEXT NOT NULL,
    lvl2_name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (lvl1_code, lvl2_code)
);

-- 种子数据(从 yufeng_category_dictionary.sql 复制)
INSERT INTO brand_tamkoko_cfg.dim_category_lvl1 (lvl1_code, lvl1_name, sort_order) VALUES
  ('INCOME',    '收入',       10),
  ('MATERIAL',  '原料采购',   20),
  ('RENT',      '租金',       30),
  ('HR',        '人工',       40),
  ('MKT',       '市场费用',   50),
  ('UTIL',      '水电费',     60),
  ('TAX',       '税费',       70),
  ('LOAN',      '借款',       80),
  ('OWNER',     '股东往来',   90),
  ('OTHER',     '其他',       99)
ON CONFLICT (lvl1_code) DO NOTHING;

INSERT INTO brand_tamkoko_cfg.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, sort_order) VALUES
  ('INCOME',   'SALES',       '销售收入',   10),
  ('INCOME',   'REFUND',      '退款',       20),
  ('MATERIAL', 'INGREDIENT',  '食材',       10),
  ('MATERIAL', 'PACKAGING',   '包材',       20),
  ('RENT',     'STORE_RENT',  '门店租金',   10),
  ('HR',       'SALARY',      '工资',       10),
  ('HR',       'SOCIAL',      '社保',       20),
  ('MKT',      'MEITUAN',     '美团',       10),
  ('MKT',      'TAOBAO',      '淘宝',       20),
  ('MKT',      'DOUYIN',      '抖音',       30),
  ('UTIL',     'ELECTRIC',    '电费',       10),
  ('UTIL',     'WATER',       '水费',       20),
  ('TAX',      'VAT',         '增值税',     10),
  ('TAX',      'CIT',         '企业所得税', 20),
  ('LOAN',     'BANK_LOAN',   '银行贷款',   10),
  ('OWNER',    'INVEST',      '股东投入',   10),
  ('OWNER',    'DRAW',        '股东支取',   20),
  ('OTHER',    'MISC',        '杂项',       10)
ON CONFLICT (lvl1_code, lvl2_code) DO NOTHING;
