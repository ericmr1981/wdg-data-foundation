-- Tamkoko | 收银明细 ODS
-- 企迈"收银明细表"CSV 导入目标表,每行 = 一个净订单(同订单号多行 SUM 合并)
-- 与 brand_tamkoko_ods.income_detail 平行,语义上不重叠:income_detail 是支付级,
-- 本表是订单聚合级(用于销售报表)

CREATE SCHEMA IF NOT EXISTS brand_tamkoko_ods;

CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.cash_register_order (
    id              BIGSERIAL PRIMARY KEY,
    store_code      TEXT        NOT NULL,
    store_name      TEXT        NOT NULL,
    biz_date        DATE        NOT NULL,
    order_no        TEXT        NOT NULL,
    order_source    TEXT        NOT NULL,
    order_type      TEXT        NOT NULL,
    meal_period     TEXT,
    gross_amt       NUMERIC(14,2) NOT NULL DEFAULT 0,
    revenue_amt     NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amt    NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_amt         NUMERIC(14,2) NOT NULL DEFAULT 0,
    qty             NUMERIC(14,2) NOT NULL DEFAULT 0,
    source_file_id  BIGINT        NOT NULL REFERENCES raw.ingest_file(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (source_file_id, order_no)
);

CREATE INDEX IF NOT EXISTS idx_cro_store_date
    ON brand_tamkoko_ods.cash_register_order (store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_cro_source_type
    ON brand_tamkoko_ods.cash_register_order (store_code, biz_date, order_source, order_type);

COMMENT ON TABLE brand_tamkoko_ods.cash_register_order IS
    '收银明细(净订单);同订单号 SUM 求净后入库;UNIQUE 在 source_file_id 内生效,'
    '跨文件允许叠加(运营重传历史),如需替换同月份用 raw.ingest_file 删除触发 ON DELETE CASCADE';
COMMENT ON COLUMN brand_tamkoko_ods.cash_register_order.order_no IS
    '保留原始反引号前缀(企迈导出特征)';
COMMENT ON COLUMN brand_tamkoko_ods.cash_register_order.meal_period IS
    '早市/午市/晚市;CSV 缺该列时 NULL,DM 视图 COALESCE 为 ''未分类''';
