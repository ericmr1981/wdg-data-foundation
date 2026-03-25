-- Brands/Stores registry (C2)
-- Supports new brands with schema prefix brand_<code>_*

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.brands (
  brand_code    TEXT PRIMARY KEY,
  brand_name    TEXT NOT NULL,
  schema_prefix TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops.stores (
  brand_code   TEXT NOT NULL REFERENCES ops.brands(brand_code),
  store_code   TEXT NOT NULL,
  store_name   TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_code, store_code)
);

-- Seed legacy brands if missing
INSERT INTO ops.brands (brand_code, brand_name, schema_prefix)
VALUES
  ('yufeng', '榆枫与山', 'yufeng'),
  ('bonjur', '本就', 'bonjur')
ON CONFLICT (brand_code) DO NOTHING;

-- Seed known stores (best-effort)
INSERT INTO ops.stores (brand_code, store_code, store_name)
VALUES
  ('yufeng', 'yf_gh', '榆枫国华'),
  ('bonjur', 'wz_oh_wxc', '温州瓯海万象城店'),
  ('bonjur', 'wz_ra_wy', '温州瑞安吾悦广场店')
ON CONFLICT (brand_code, store_code) DO NOTHING;
