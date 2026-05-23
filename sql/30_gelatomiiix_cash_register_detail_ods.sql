-- gelatomiiix｜收银明细（收银明细表导入）
CREATE SCHEMA IF NOT EXISTS gelatomiiix_ods;

CREATE TABLE IF NOT EXISTS gelatomiiix_ods.cash_register_detail (
  id              BIGSERIAL PRIMARY KEY,
  store_code      TEXT NOT NULL,
  store_name      TEXT,
  biz_date        DATE NOT NULL,
  order_no        TEXT NOT NULL,

  gross_amt       NUMERIC(14,2),
  revenue_amt     NUMERIC(14,2),
  discount_amt    NUMERIC(14,2),
  net_amt         NUMERIC(14,2),
  txn_qty         INT,

  payment_method  TEXT,

  source_file_id  BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_gelatomiiix_cash_register_detail UNIQUE (store_code, order_no)
);

CREATE INDEX IF NOT EXISTS idx_gelatomiiix_cash_register_detail_date
  ON gelatomiiix_ods.cash_register_detail(biz_date);
CREATE INDEX IF NOT EXISTS idx_gelatomiiix_cash_register_detail_store_date
  ON gelatomiiix_ods.cash_register_detail(store_code, biz_date);
