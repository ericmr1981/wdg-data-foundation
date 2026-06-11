-- sql/00_brand_seed_fix.sql
-- Add missing brand registrations for gelatomiiix and tamkoko (brands, stores, allowed_schemas).
-- These were already used in the app but not registered in ops tables.

-- 1. Add missing brands
INSERT INTO ops.brands (brand_code, brand_name, schema_prefix)
VALUES
  ('gelatomiiix', '蜜可诗', 'brand_gelatomiiix'),
  ('tamkoko', '泰柯茶园', 'brand_tamkoko')
ON CONFLICT (brand_code) DO UPDATE
  SET brand_name = EXCLUDED.brand_name,
      schema_prefix = EXCLUDED.schema_prefix;

-- 2. Add missing allowed_schemas entries
INSERT INTO ops.allowed_schemas (schema_name, brand_code, description)
VALUES
  -- gelatomiiix
  ('brand_gelatomiiix', 'gelatomiiix', 'brand_gelatomiiix shared schema'),
  ('brand_gelatomiiix_ods', 'gelatomiiix', 'brand_gelatomiiix ODS layer'),
  ('brand_gelatomiiix_cfg', 'gelatomiiix', 'brand_gelatomiiix config/rules'),
  ('brand_gelatomiiix_dm', 'gelatomiiix', 'brand_gelatomiiix data mart'),
  -- tamkoko
  ('brand_tamkoko', 'tamkoko', 'brand_tamkoko shared schema'),
  ('brand_tamkoko_ods', 'tamkoko', 'brand_tamkoko ODS layer'),
  ('brand_tamkoko_cfg', 'tamkoko', 'brand_tamkoko config/rules'),
  ('brand_tamkoko_dm', 'tamkoko', 'brand_tamkoko data mart')
ON CONFLICT (schema_name) DO NOTHING;
