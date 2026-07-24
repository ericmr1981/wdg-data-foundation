-- gelatomiiix｜product_sales_detail 添加缺失列
-- 背景: commit 342d1f1 在 TABLE_DDL (scripts/import) 中扩展了 26 列 schema,
--       但 DB 持久层的 product_sales_detail 表仍为 14 列旧版,导致 import 报 UndefinedColumn。
-- 本 migration 将生产表对齐到 26 列,与 scripts/import_gelatomiiix_product_sales.py 的 TABLE_DDL 一致。

ALTER TABLE gelatomiiix_ods.product_sales_detail
  ADD COLUMN IF NOT EXISTS spec            TEXT,
  ADD COLUMN IF NOT EXISTS category        TEXT,
  ADD COLUMN IF NOT EXISTS product_type    TEXT,
  ADD COLUMN IF NOT EXISTS product_kind    TEXT,
  ADD COLUMN IF NOT EXISTS add_on          TEXT,
  ADD COLUMN IF NOT EXISTS sku_id          TEXT,
  ADD COLUMN IF NOT EXISTS product_id      TEXT,
  ADD COLUMN IF NOT EXISTS product_library TEXT,
  ADD COLUMN IF NOT EXISTS order_source    TEXT,
  ADD COLUMN IF NOT EXISTS order_type      TEXT,
  ADD COLUMN IF NOT EXISTS meal_period     TEXT,
  ADD COLUMN IF NOT EXISTS ordered_at      TIMESTAMPTZ;
