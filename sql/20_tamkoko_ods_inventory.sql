-- ============================================================
-- brand_tamkoko_ods.inventory_month_end 月末库存快照
-- 一行 = (store, period, sku) 一条期末库存记录
-- 幂等：源文件维度 UNIQUE 约束 + 导入脚本 DELETE WHERE source_file_id=?
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.inventory_month_end (
  id              bigserial PRIMARY KEY,
  brand_code      text NOT NULL DEFAULT 'tamkoko',
  store_code      text NOT NULL,
  period          text NOT NULL,
  category        text NOT NULL,
  sku             text NOT NULL,
  material_name   text NOT NULL,
  spec            text,
  unit_price      numeric(12, 2) NOT NULL,
  qty             numeric(12, 3) NOT NULL,
  unit            text NOT NULL,
  amount          numeric(14, 2) NOT NULL,
  source_file_id  bigint NOT NULL REFERENCES raw.ingest_file(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tamkoko_inventory_per_file
    UNIQUE (store_code, period, sku, source_file_id)
);

CREATE INDEX IF NOT EXISTS idx_tamkoko_inventory_store_period
  ON brand_tamkoko_ods.inventory_month_end (store_code, period);
