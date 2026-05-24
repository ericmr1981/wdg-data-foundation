-- ============================================================
-- 新增 TAX_SURCHARGE（税金及附加）一级分类
-- 位置：营业成本（MATERIAL）与期间费用之间
-- 影响：利润表 + 现金流量表
-- 适用：brand_gelatomiiix_cfg（需同步到品牌专属 cfg schema）
-- ============================================================

-- TAX_SURCHARGE lvl1（在 MATERIAL(70) 与 MKT(90) 之间排序）
INSERT INTO brand_gelatomiiix_cfg.dim_category_lvl1 (lvl1_code, lvl1_name, direction, sort_order)
VALUES ('TAX_SURCHARGE', '税金及附加', 'out', 75)
ON CONFLICT (lvl1_code) DO UPDATE SET
  lvl1_name     = EXCLUDED.lvl1_name,
  direction     = EXCLUDED.direction,
  sort_order    = EXCLUDED.sort_order,
  enabled       = TRUE,
  updated_at    = NOW();

-- TAX_SURCHARGE lvl2（子科目）
WITH lvl2(lvl1_code, lvl2_code, lvl2_name, sort_order) AS (
  VALUES
    ('TAX_SURCHARGE','URBAN_CONS','城建税',10),
    ('TAX_SURCHARGE','EDUCATION','教育费附加',20),
    ('TAX_SURCHARGE','LOCAL_EDU','地方教育附加',30),
    ('TAX_SURCHARGE','STAMP','印花税',40),
    ('TAX_SURCHARGE','PROPERTY','房产税',50),
    ('TAX_SURCHARGE','SURCHARGE_OTHER','其他税费',60)
)
INSERT INTO brand_gelatomiiix_cfg.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, sort_order)
SELECT * FROM lvl2
ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE SET
  lvl2_name  = EXCLUDED.lvl2_name,
  sort_order = EXCLUDED.sort_order,
  enabled    = TRUE,
  updated_at = NOW();
