-- Add sort_order to ops.brands and ops.stores (C2 enhancement)

ALTER TABLE ops.brands ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 9999;
ALTER TABLE ops.stores ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 9999;

CREATE INDEX IF NOT EXISTS idx_brands_sort_order ON ops.brands(sort_order, brand_code);
CREATE INDEX IF NOT EXISTS idx_stores_brand_sort ON ops.stores(brand_code, sort_order, store_code);

-- Initialize existing brands with sequential order
WITH ranked AS (
  SELECT brand_code, ROW_NUMBER() OVER (ORDER BY created_at, brand_code) AS rn
  FROM ops.brands
)
UPDATE ops.brands b SET sort_order = (r.rn - 1) * 10
FROM ranked r WHERE b.brand_code = r.brand_code;

-- Initialize existing stores with sequential order (per brand)
WITH ranked AS (
  SELECT brand_code, store_code, ROW_NUMBER() OVER (PARTITION BY brand_code ORDER BY created_at, store_code) AS rn
  FROM ops.stores
)
UPDATE ops.stores s SET sort_order = (r.rn - 1) * 10
FROM ranked r WHERE s.brand_code = r.brand_code AND s.store_code = r.store_code;
