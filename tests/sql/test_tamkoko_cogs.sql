-- ============================================================
-- tamkoko COGS 视图端到端断言
-- 前置：已跑完 import 4 月、5 月 fixture（store_code='hz_fuyang_test'）
-- 执行：psql -f tests/sql/test_tamkoko_cogs.sql
-- ============================================================

-- 1) v_inventory_summary 行数 = 2 (4月 + 5月)
SELECT 'v_inventory_summary count' AS check_name, COUNT(*) AS actual
FROM brand_tamkoko_dm.v_inventory_summary
WHERE store_code='hz_fuyang_test';
-- 期望: 2

-- 2) v_cogs_monthly: 4月 cogs_amt IS NULL（首期）
SELECT '4月 cogs IS NULL' AS check_name, cogs_amt
FROM brand_tamkoko_dm.v_cogs_monthly
WHERE store_code='hz_fuyang_test' AND period='2026-04';
-- 期望: NULL

-- 3) v_cogs_monthly: 5月 cogs_amt 非 NULL
SELECT '5月 cogs > 0' AS check_name, cogs_amt
FROM brand_tamkoko_dm.v_cogs_monthly
WHERE store_code='hz_fuyang_test' AND period='2026-05';
-- 期望: numeric, > 0

-- 4) v_store_monthly_kpi: 4月 gross/net_profit_rate_pct IS NULL
SELECT '4月 gross/net_pct IS NULL' AS check_name,
       gross_profit_rate_pct, net_profit_rate_pct
FROM brand_tamkoko_dm.v_store_monthly_kpi
WHERE store_code='hz_fuyang_test' AND to_char(month,'YYYY-MM')='2026-04';
-- 期望: NULL, NULL

-- 5) v_store_monthly_kpi: 5月 gross/net_profit_rate_pct 非 NULL
SELECT '5月 gross/net_pct 非 NULL' AS check_name,
       gross_profit_rate_pct, net_profit_rate_pct
FROM brand_tamkoko_dm.v_store_monthly_kpi
WHERE store_code='hz_fuyang_test' AND to_char(month,'YYYY-MM')='2026-05';
-- 期望: numeric, numeric
