-- Bonjur｜商品销售明细（商品销售明细表导入）
-- 来源: 企迈导出 CSV（商品销售明细表）

CREATE SCHEMA IF NOT EXISTS bonjur_ods;

CREATE TABLE IF NOT EXISTS bonjur_ods.product_sales_detail (
    id              BIGSERIAL PRIMARY KEY,
    store_code      TEXT NOT NULL,
    store_name      TEXT,
    biz_date        DATE NOT NULL,
    order_no        TEXT NOT NULL,

    product_name    TEXT NOT NULL,
    unit_price      NUMERIC(14,2),
    qty             INT,
    sales_amt       NUMERIC(14,2),
    received_amt    NUMERIC(14,2),
    discount_amt    NUMERIC(14,2),
    order_hour      TEXT,

    source_file_id  BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_bonjur_product_sales_detail UNIQUE (store_code, order_no, product_name)
);

CREATE INDEX IF NOT EXISTS idx_bonjur_product_sales_detail_date
    ON bonjur_ods.product_sales_detail (biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_product_sales_detail_store_date
    ON bonjur_ods.product_sales_detail (store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_bonjur_product_sales_detail_product
    ON bonjur_ods.product_sales_detail (product_name);

COMMENT ON TABLE bonjur_ods.product_sales_detail IS 'Bonjur 企迈商品销售明细表';
