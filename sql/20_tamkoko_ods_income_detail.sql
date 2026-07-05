-- Tamkoko｜企迈收入明细表
-- 字段与 bonjur 一致,沿用 Qimai 模板(用户决策)

CREATE SCHEMA IF NOT EXISTS brand_tamkoko_ods;

CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.income_detail (
    id                  BIGSERIAL PRIMARY KEY,
    store_code          TEXT NOT NULL,
    brand_name          TEXT,
    city                TEXT,
    store_name          TEXT,
    biz_date            DATE NOT NULL,
    order_no            TEXT NOT NULL,
    channel             TEXT,
    gross_amt           NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_amt             NUMERIC(14,2) NOT NULL DEFAULT 0,
    revenue_amt         NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_methods     TEXT[],
    third_party_txn_no  TEXT,
    order_source        TEXT,
    order_type          TEXT,
    source_file         TEXT,
    source_file_id      BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tamkoko_income_detail UNIQUE (store_code, order_no)
);

CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_biz_date
  ON brand_tamkoko_ods.income_detail (biz_date);
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_store_biz_date
  ON brand_tamkoko_ods.income_detail (store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_channel
  ON brand_tamkoko_ods.income_detail (channel);
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_third_party_txn
  ON brand_tamkoko_ods.income_detail (third_party_txn_no);

COMMENT ON TABLE brand_tamkoko_ods.income_detail IS 'Tamkoko 企迈收入明细表';
COMMENT ON COLUMN brand_tamkoko_ods.income_detail.channel IS '支付渠道编码: WECHAT/ALIPAY/MEITUAN/TAOBAO/DOUYIN/OTHER';
