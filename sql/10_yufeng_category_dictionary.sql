-- 分类字典 v1.1（共享：Yufeng + Bonjur）
-- 来源：ProjectTasks.md 1.6（v1.1 定稿）
-- 说明：不包含“未分类”字典项；未命中时 code 允许为 NULL。
--
-- IMPORTANT:
-- - 同一套字典会写入两个 schema：yufeng_cfg / bonjur_cfg
-- - 这样 Bonjur 的 DM/接口也能直接 join 字典表，不依赖跨 brand schema。

CREATE SCHEMA IF NOT EXISTS yufeng_cfg;
CREATE SCHEMA IF NOT EXISTS bonjur_cfg;

CREATE TABLE IF NOT EXISTS yufeng_cfg.dim_category_lvl1 (
  lvl1_code   TEXT PRIMARY KEY,
  lvl1_name   TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'any', -- in | out | any
  sort_order  INT  NOT NULL DEFAULT 9999,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS yufeng_cfg.dim_category_lvl2 (
  lvl1_code   TEXT NOT NULL,
  lvl2_code   TEXT NOT NULL,
  lvl2_name   TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 9999,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lvl1_code, lvl2_code)
);

CREATE TABLE IF NOT EXISTS bonjur_cfg.dim_category_lvl1 (
  lvl1_code   TEXT PRIMARY KEY,
  lvl1_name   TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'any',
  sort_order  INT  NOT NULL DEFAULT 9999,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonjur_cfg.dim_category_lvl2 (
  lvl1_code   TEXT NOT NULL,
  lvl2_code   TEXT NOT NULL,
  lvl2_name   TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 9999,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lvl1_code, lvl2_code)
);

WITH lvl1(lvl1_code, lvl1_name, direction, sort_order) AS (
  VALUES
    ('REV_BIZ',   '营业收入', 'in',  10),
    ('REV_OTHER', '其他收入', 'in',  20),
    ('RENT_UTIL', '租金物业', 'out', 30),
    ('HR',        '人力',     'out', 40),
    ('SHIP',      '运费',     'out', 50),
    ('ADMIN',     '管理费用', 'out', 60),
    ('MATERIAL',  '材料采购', 'out', 70),
    ('BUILD',     '营建费用', 'out', 80),
    ('MKT',       '营销费用', 'out', 90),
    ('EXP_OTHER', '其他费用', 'out', 100)
)
INSERT INTO yufeng_cfg.dim_category_lvl1 (lvl1_code, lvl1_name, direction, sort_order)
SELECT * FROM lvl1
ON CONFLICT (lvl1_code) DO UPDATE SET
  lvl1_name=EXCLUDED.lvl1_name,
  direction=EXCLUDED.direction,
  sort_order=EXCLUDED.sort_order,
  enabled=TRUE,
  updated_at=NOW();

WITH lvl1(lvl1_code, lvl1_name, direction, sort_order) AS (
  VALUES
    ('REV_BIZ',   '营业收入', 'in',  10),
    ('REV_OTHER', '其他收入', 'in',  20),
    ('RENT_UTIL', '租金物业', 'out', 30),
    ('HR',        '人力',     'out', 40),
    ('SHIP',      '运费',     'out', 50),
    ('ADMIN',     '管理费用', 'out', 60),
    ('MATERIAL',  '材料采购', 'out', 70),
    ('BUILD',     '营建费用', 'out', 80),
    ('MKT',       '营销费用', 'out', 90),
    ('EXP_OTHER', '其他费用', 'out', 100)
)
INSERT INTO bonjur_cfg.dim_category_lvl1 (lvl1_code, lvl1_name, direction, sort_order)
SELECT * FROM lvl1
ON CONFLICT (lvl1_code) DO UPDATE SET
  lvl1_name=EXCLUDED.lvl1_name,
  direction=EXCLUDED.direction,
  sort_order=EXCLUDED.sort_order,
  enabled=TRUE,
  updated_at=NOW();

WITH lvl2(lvl1_code, lvl2_code, lvl2_name, sort_order) AS (
  VALUES
    -- REV_BIZ
    ('REV_BIZ','MEITUAN','美团',10),
    ('REV_BIZ','ELEME','饿了么',20),
    ('REV_BIZ','DOUYIN','抖音',30),
    ('REV_BIZ','JD','京东',40),
    ('REV_BIZ','WECHAT','微信/财付通',50),
    ('REV_BIZ','ALIPAY','支付宝',60),
    ('REV_BIZ','UNIONPAY','银联云闪付',65),
    ('REV_BIZ','OTHER_CH','其他渠道',70),

    -- REV_OTHER
    ('REV_OTHER','INVEST_IN','注资',10),
    ('REV_OTHER','BORROW_IN','借款',20),
    ('REV_OTHER','LOAN_IN','贷款',30),
    ('REV_OTHER','INTEREST_IN','利息',40),
    ('REV_OTHER','TAX_REFUND','退税',50),
    ('REV_OTHER','REFUND_IN','退款',60),

    -- RENT_UTIL
    ('RENT_UTIL','RENT','租金',10),
    ('RENT_UTIL','PROP','物业费',20),
    ('RENT_UTIL','WATER_ELEC','水电费',30),

    -- HR
    ('HR','SALARY','工资',10),
    ('HR','SS','社保',20),
    ('HR','LABOR','劳务派遣',30),
    ('HR','HR_SVC','人力服务',40),

    -- SHIP
    ('SHIP','HLALA','货拉拉',10),
    ('SHIP','EXPRESS','快递',20),
    ('SHIP','CITY','同城配送',30),
    ('SHIP','SHIP_OTHER','其他运费',40),

    -- ADMIN
    ('ADMIN','SAAS','系统使用费',10),
    ('ADMIN','OFFICE','办公费用',20),
    ('ADMIN','TRAVEL','差旅费',30),
    ('ADMIN','REPAIR','维修费',40),
    ('ADMIN','ADMIN_OTHER','其他管理',50),
    ('ADMIN','BANK_FEE','银行手续费',60),
    ('ADMIN','CHANNEL_FEE','支付通道费',70),

    -- MATERIAL
    ('MATERIAL','RAW','原材料',10),
    ('MATERIAL','AUX','辅料',20),
    ('MATERIAL','PACK','包装',30),
    ('MATERIAL','BUY_OTHER','其他采购',40),

    -- BUILD
    ('BUILD','ENG_FEE','工程款',10),
    ('BUILD','CONST_FEE','施工费',20),
    ('BUILD','DECOR_FEE','装修费',30),
    ('BUILD','EQUIP_BUY','设备采购',40),
    ('BUILD','BUILD_OTHER','其他营建',50),

    -- MKT
    ('MKT','ADS','广告费',10),
    ('MKT','GIFT','礼品费',20),
    ('MKT','PROMO','推广费',30),
    ('MKT','MKT_FEE','营销费',40),
    ('MKT','MKT_OTHER','其他营销',50)
)
INSERT INTO yufeng_cfg.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, sort_order)
SELECT * FROM lvl2
ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE SET
  lvl2_name=EXCLUDED.lvl2_name,
  sort_order=EXCLUDED.sort_order,
  enabled=TRUE,
  updated_at=NOW();

WITH lvl2(lvl1_code, lvl2_code, lvl2_name, sort_order) AS (
  VALUES
    -- REV_BIZ
    ('REV_BIZ','MEITUAN','美团',10),
    ('REV_BIZ','ELEME','饿了么',20),
    ('REV_BIZ','DOUYIN','抖音',30),
    ('REV_BIZ','JD','京东',40),
    ('REV_BIZ','WECHAT','微信/财付通',50),
    ('REV_BIZ','ALIPAY','支付宝',60),
    ('REV_BIZ','UNIONPAY','银联云闪付',65),
    ('REV_BIZ','OTHER_CH','其他渠道',70),

    -- REV_OTHER
    ('REV_OTHER','INVEST_IN','注资',10),
    ('REV_OTHER','BORROW_IN','借款',20),
    ('REV_OTHER','LOAN_IN','贷款',30),
    ('REV_OTHER','INTEREST_IN','利息',40),
    ('REV_OTHER','TAX_REFUND','退税',50),
    ('REV_OTHER','REFUND_IN','退款',60),

    -- RENT_UTIL
    ('RENT_UTIL','RENT','租金',10),
    ('RENT_UTIL','PROP','物业费',20),
    ('RENT_UTIL','WATER_ELEC','水电费',30),

    -- HR
    ('HR','SALARY','工资',10),
    ('HR','SS','社保',20),
    ('HR','LABOR','劳务派遣',30),
    ('HR','HR_SVC','人力服务',40),

    -- SHIP
    ('SHIP','HLALA','货拉拉',10),
    ('SHIP','EXPRESS','快递',20),
    ('SHIP','CITY','同城配送',30),
    ('SHIP','SHIP_OTHER','其他运费',40),

    -- ADMIN
    ('ADMIN','SAAS','系统使用费',10),
    ('ADMIN','OFFICE','办公费用',20),
    ('ADMIN','TRAVEL','差旅费',30),
    ('ADMIN','REPAIR','维修费',40),
    ('ADMIN','ADMIN_OTHER','其他管理',50),
    ('ADMIN','BANK_FEE','银行手续费',60),
    ('ADMIN','CHANNEL_FEE','支付通道费',70),

    -- MATERIAL
    ('MATERIAL','RAW','原材料',10),
    ('MATERIAL','AUX','辅料',20),
    ('MATERIAL','PACK','包装',30),
    ('MATERIAL','BUY_OTHER','其他采购',40),

    -- BUILD
    ('BUILD','ENG_FEE','工程款',10),
    ('BUILD','CONST_FEE','施工费',20),
    ('BUILD','DECOR_FEE','装修费',30),
    ('BUILD','EQUIP_BUY','设备采购',40),
    ('BUILD','BUILD_OTHER','其他营建',50),

    -- MKT
    ('MKT','ADS','广告费',10),
    ('MKT','GIFT','礼品费',20),
    ('MKT','PROMO','推广费',30),
    ('MKT','MKT_FEE','营销费',40),
    ('MKT','MKT_OTHER','其他营销',50)
)
INSERT INTO bonjur_cfg.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, sort_order)
SELECT * FROM lvl2
ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE SET
  lvl2_name=EXCLUDED.lvl2_name,
  sort_order=EXCLUDED.sort_order,
  enabled=TRUE,
  updated_at=NOW();
