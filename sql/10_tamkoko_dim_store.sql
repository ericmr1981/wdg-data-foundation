-- ============================================================
-- brand_tamkoko_cfg.dim_store 门店维度
-- 种子数据从 ops.stores(brand_code='tamkoko', enabled=true) 派生
-- ============================================================

CREATE SCHEMA IF NOT EXISTS brand_tamkoko_cfg;

CREATE TABLE IF NOT EXISTS brand_tamkoko_cfg.dim_store (
    store_code    TEXT PRIMARY KEY,
    store_name    TEXT NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order    INT NOT NULL DEFAULT 9999,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO brand_tamkoko_cfg.dim_store (store_code, store_name, enabled, sort_order)
SELECT store_code, store_name, enabled, sort_order
FROM ops.stores
WHERE brand_code = 'tamkoko' AND enabled = true
ON CONFLICT (store_code) DO UPDATE
  SET store_name = EXCLUDED.store_name,
      enabled = EXCLUDED.enabled,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW();
