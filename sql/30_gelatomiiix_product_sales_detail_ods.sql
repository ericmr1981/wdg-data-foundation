-- gelatomiiix｜商品销售明细（商品销售明细表导入）
CREATE SCHEMA IF NOT EXISTS gelatomiiix_ods;

CREATE TABLE IF NOT EXISTS gelatomiiix_ods.product_sales_detail (
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

  spec            TEXT,
  category        TEXT,
  product_type    TEXT,
  product_kind    TEXT,
  add_on          TEXT,
  sku_id          TEXT,
  product_id      TEXT,
  product_library TEXT,
  order_source    TEXT,
  order_type      TEXT,
  meal_period     TEXT,
  ordered_at      TIMESTAMPTZ,

  source_file_id  BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_gelatomiiix_product_sales_detail UNIQUE (store_code, order_no, product_name)
);

CREATE INDEX IF NOT EXISTS idx_gelatomiiix_product_sales_detail_date
  ON gelatomiiix_ods.product_sales_detail(biz_date);
CREATE INDEX IF NOT EXISTS idx_gelatomiiix_product_sales_detail_store_date
  ON gelatomiiix_ods.product_sales_detail(store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_gelatomiiix_product_sales_detail_product
  ON gelatomiiix_ods.product_sales_detail(product_name);
