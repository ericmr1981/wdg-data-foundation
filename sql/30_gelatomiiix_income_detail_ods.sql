-- gelatomiiix｜收入明细表
-- 来源: 企迈导出 CSV（收入明细表）
-- 覆盖: 2025-08-17 ~ 2026-05-22
-- 替换: gelatomiiix_ods.cash_register_detail（旧表已废弃）
-- 说明: 结账方式拆分为多值字段，存入 payment_methods[] 数组
--       自定义结账方式（会员快速支付）不入银行，不参与入账率计算

CREATE SCHEMA IF NOT EXISTS gelatomiiix_ods;

DROP TABLE IF EXISTS gelatomiiix_ods.income_detail CASCADE;

CREATE TABLE gelatomiiix_ods.income_detail (
    id                  BIGSERIAL PRIMARY KEY,
    store_code          TEXT NOT NULL DEFAULT 'sh_xtd',
    store_name          TEXT NOT NULL DEFAULT '上海新天地广场',

    -- 订单基本信息
    biz_date            DATE NOT NULL,                  -- 营业日期
    order_no            TEXT NOT NULL,                  -- 原始订单号（含反引号前缀）
    order_no_clean      TEXT NOT NULL,                  -- 清洗后订单号（去反引号）
    pay_time            TIMESTAMPTZ,                    -- 支付时间
    order_time          TIMESTAMPTZ,                    -- 下单时间

    -- 金额字段
    revenue_amt         NUMERIC(14,2) NOT NULL DEFAULT 0, -- 营业收入
    net_amt             NUMERIC(14,2) NOT NULL DEFAULT 0, -- 营业净收
    gross_amt           NUMERIC(14,2) NOT NULL DEFAULT 0, -- 营业额（含优惠）
    discount_amt        NUMERIC(14,2) NOT NULL DEFAULT 0, -- 优惠总额
    overflow_amt        NUMERIC(14,2) NOT NULL DEFAULT 0, -- 溢收金额
    coupon_fee          NUMERIC(14,2) NOT NULL DEFAULT 0, -- 团购券手续费

    -- 支付方式（多值，可能多个以逗号分隔）
    -- 有效值: 微信支付, 支付宝支付, 美团团购券, 现金支付, 云闪付, 抖音团购券
    -- 自定义结账方式（会员快速支付）不存入此字段，单独用 is_member_payment
    payment_methods     TEXT[],                         -- 支付方式数组（不含会员支付）

    -- 第三方流水（用于与银行流水精确对账）
    -- 格式: 带反引号前缀，需在导入时清洗
    third_party_txn_no  TEXT,                           -- 三方支付流水号（去反引号后存储）
    third_party_order_no TEXT,                         -- 三方订单号（去反引号后存储）
    merchant_order_no   TEXT,                          -- 商户订单号
    coupon_id           TEXT,                          -- 三方券id

    -- 订单属性
    biz_source          TEXT,                          -- 订单来源（企迈数店POS / 微信小程序）
    order_type          TEXT,                          -- 订单类型（堂食 / 打包）
    is_refund           BOOLEAN NOT NULL DEFAULT FALSE, -- 是否反结
    is_member_payment   BOOLEAN NOT NULL DEFAULT FALSE, -- 是否为会员快速支付（不入银行）

    -- 会员信息
    member_id           TEXT,                          -- 会员id（去反引号）
    member_phone        TEXT,                          -- 用户手机号

    -- 导入元数据
    source_file         TEXT,                           -- 来源文件名
    source_file_id      BIGINT,                         -- FK -> raw.ingest_file.id
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_gelatomiiix_income_detail UNIQUE (store_code, order_no_clean)
);

-- 索引
CREATE INDEX idx_income_detail_biz_date         ON gelatomiiix_ods.income_detail (biz_date);
CREATE INDEX idx_income_detail_store_biz_date     ON gelatomiiix_ods.income_detail (store_code, biz_date);
CREATE INDEX idx_income_detail_pay_time          ON gelatomiiix_ods.income_detail (pay_time);
CREATE INDEX idx_income_detail_third_party_txn   ON gelatomiiix_ods.income_detail (third_party_txn_no);
CREATE INDEX idx_income_detail_member            ON gelatomiiix_ods.income_detail (member_id)
    WHERE member_id IS NOT NULL;

-- 注释
COMMENT ON TABLE gelatomiiix_ods.income_detail IS '企迈收入明细表（替换收银明细表），2025-08-17起';
COMMENT ON COLUMN gelatomiiix_ods.income_detail.order_no_clean IS '去反引号前缀后的订单号，用于唯一约束';
COMMENT ON COLUMN gelatomiiix_ods.income_detail.is_member_payment IS '自定义结账方式（会员快速支付），资金不走银行，不参与入账率计算';
COMMENT ON COLUMN gelatomiiix_ods.income_detail.payment_methods IS '支付方式数组，仅包含第三方支付（微信/支付宝/美团/云闪付/抖音），会员支付除外';