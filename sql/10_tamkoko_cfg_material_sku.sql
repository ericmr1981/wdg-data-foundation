-- ============================================================
-- brand_tamkoko_cfg.material_sku 物料字典
-- 主键：sku（SKU 编码）
-- 由 import_tamkoko_inventory.py 在导入时 UPSERT
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_tamkoko_cfg.material_sku (
  sku               text PRIMARY KEY,
  material_name     text NOT NULL,
  category          text NOT NULL,
  spec              text,
  unit              text NOT NULL,
  unit_price        numeric(12, 2) NOT NULL,
  first_seen_period text NOT NULL,
  last_seen_period  text NOT NULL,
  is_active         boolean NOT NULL DEFAULT TRUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tamkoko_material_sku_category
  ON brand_tamkoko_cfg.material_sku (category);
