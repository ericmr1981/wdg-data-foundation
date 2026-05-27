-- Bonjur｜企迈收入明细表
-- 来源: 企迈导出 CSV（收入明细表）
-- 说明: 与 gelatomiiix_ods.income_detail 结构类似，但包含品牌/城市/门店/渠道等 CSV 列字段

CREATE SCHEMA IF NOT EXISTS bonjur_ods;

CREATE TABLE IF NOT EXISTS bonjur_ods.income_detail (
    id                  BIGSERIAL PRIMARY KEY,

    -- 门店 & 品牌信息（来自 CSV 列）
    store_code          TEXT NOT NULL,
    brand_name          TEXT,                           -- 品牌名（CSV 列）
    city                TEXT,                           -- 城市（CSV 列）
    store_name          TEXT,                           -- 门店名（CSV 列）

    -- 订单基本信息
    biz_date            DATE NOT NULL,                  -- 营业日期
    order_no            TEXT NOT NULL,                  -- 清洗后订单号（去反引号）

    -- 支付渠道（枚举: WECHAT/ALIPAY/MEITUAN/TAOBAO/DOUYIN/OTHER）
    channel             TEXT,

    -- 金额字段
    gross_amt           NUMERIC(14,2) NOT NULL DEFAULT 0, -- 营业额
    net_amt             NUMERIC(14,2) NOT NULL DEFAULT 0, -- 营业净收
    revenue_amt         NUMERIC(14,2) NOT NULL DEFAULT 0, -- 营业收入

    -- 支付方式（多值数组，如 {'微信支付','支付宝支付'}）
    payment_methods     TEXT[],

    -- 第三方流水号
    third_party_txn_no  TEXT,

    -- 订单属性
    order_source        TEXT,                           -- 订单来源（CSV 列）
    order_type          TEXT,                           -- 订单类型（CSV 列）

    -- 导入元数据
    source_file         TEXT,                           -- 来源文件名
    source_file_id      BIGINT,                         -- FK -> raw.ingest_file.id
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_bonjur_income_detail UNIQUE (store_code, order_no)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_biz_date
    ON bonjur_ods.income_detail (biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_store_biz_date
    ON bonjur_ods.income_detail (store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_channel
    ON bonjur_ods.income_detail (channel);
CREATE INDEX IF NOT EXISTS idx_bonjur_income_detail_third_party_txn
    ON bonjur_ods.income_detail (third_party_txn_no);

-- 注释
COMMENT ON TABLE bonjur_ods.income_detail IS 'Bonjur 企迈收入明细表';
COMMENT ON COLUMN bonjur_ods.income_detail.channel IS '支付渠道编码: WECHAT/ALIPAY/MEITUAN/TAOBAO/DOUYIN/OTHER';
COMMENT ON COLUMN bonjur_ods.income_detail.payment_methods IS '支付方式数组（中文名，如 {微信支付,支付宝支付}）';
