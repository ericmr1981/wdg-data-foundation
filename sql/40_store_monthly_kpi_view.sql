-- ============================================================
-- v_store_monthly_kpi: 门店月报专用视图
-- 一行 = (品牌 schema 内) 1 月 × 1 门店，9 个核心财务指标 + 中间量
-- 依赖：v_profit_statement / v_cashflow_statement / v_balance_sheet
-- 适用：bonjur_dm / brand_gelatomiiix_dm / brand_tamkoko_dm
-- ============================================================

-- bonjur (cogs basis, will activate after inventory upload is added in a future commit)
DROP VIEW IF EXISTS bonjur_dm.v_store_monthly_kpi;
CREATE OR REPLACE VIEW bonjur_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN lvl1_code = 'MATERIAL' THEN ABS(amount) ELSE 0 END) AS cost_amt,
    -- non_cogs_expense_amt: HR + MKT + RENT_UTIL + SHIP + ADMIN + EXP_OTHER (excl. BONUS)
    SUM(CASE WHEN (lvl1_code IN ('HR','MKT','RENT_UTIL','SHIP','ADMIN')
                  OR (lvl1_code='EXP_OTHER' AND lvl2_code <> 'BONUS'))
              THEN ABS(amount) ELSE 0 END) AS non_cogs_expense_amt,
    -- expense_amt: kept for KPI card display (sum of all operating expenses incl. MATERIAL)
    SUM(CASE WHEN (lvl1_code IN ('HR','MATERIAL','MKT','RENT_UTIL','SHIP','ADMIN')
                  OR (lvl1_code='EXP_OTHER' AND lvl2_code <> 'BONUS'))
              THEN ABS(amount) ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM bonjur_dm.v_profit_statement GROUP BY month, store_code
),
-- cogs_agg: placeholder returns no rows. bonjur has no inventory data yet.
-- Future commit: replace with `SELECT store_code, period, cogs_amt FROM bonjur_dm.v_cogs_monthly`
cogs_agg AS (
  SELECT NULL::text AS store_code, NULL::text AS period, NULL::numeric AS cogs_amt WHERE FALSE
),
cashflow_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END) AS operating_cf_amt,
    SUM(total_in)  AS total_in_amt,
    SUM(total_out) AS total_out_amt
  FROM bonjur_dm.v_cashflow_statement GROUP BY month, store_code
)
SELECT
  p.month, p.store_code,
  p.revenue_amt, p.cost_amt, p.expense_amt, p.hr_amt, p.rent_amt,
  cg.cogs_amt,
  CASE WHEN cg.cogs_amt IS NULL THEN NULL
       ELSE p.revenue_amt - cg.cogs_amt END AS gross_profit_amt,
  CASE WHEN cg.cogs_amt IS NULL THEN NULL
       ELSE p.revenue_amt - cg.cogs_amt - p.non_cogs_expense_amt END AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(ABS(p.hr_amt)::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(ABS(p.rent_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct,
  CASE WHEN cg.cogs_amt IS NULL OR p.revenue_amt = 0 THEN NULL
       ELSE ROUND((p.revenue_amt - cg.cogs_amt)::numeric / p.revenue_amt * 100, 1) END
    AS gross_profit_rate_pct,
  CASE WHEN cg.cogs_amt IS NULL OR p.revenue_amt = 0 THEN NULL
       ELSE ROUND((p.revenue_amt - cg.cogs_amt - p.non_cogs_expense_amt)::numeric / p.revenue_amt * 100, 1) END
    AS net_profit_rate_pct
FROM profit_agg p
LEFT JOIN cogs_agg cg
  ON cg.period = to_char(p.month, 'YYYY-MM') AND cg.store_code = p.store_code
LEFT JOIN cashflow_agg c ON c.month = p.month AND c.store_code = p.store_code
LEFT JOIN bonjur_dm.v_balance_sheet b ON b.month = p.month AND b.store_code = p.store_code;

-- brand_gelatomiiix_dm (cogs basis, will activate after inventory upload is added in a future commit)
DROP VIEW IF EXISTS brand_gelatomiiix_dm.v_store_monthly_kpi;
CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN lvl1_code = 'MATERIAL' THEN ABS(amount) ELSE 0 END) AS cost_amt,
    -- non_cogs_expense_amt: HR + MKT + RENT_UTIL + SHIP + ADMIN + EXP_OTHER (excl. BONUS)
    SUM(CASE WHEN (lvl1_code IN ('HR','MKT','RENT_UTIL','SHIP','ADMIN')
                  OR (lvl1_code='EXP_OTHER' AND lvl2_code <> 'BONUS'))
              THEN ABS(amount) ELSE 0 END) AS non_cogs_expense_amt,
    -- expense_amt: kept for KPI card display (sum of all operating expenses incl. MATERIAL)
    SUM(CASE WHEN (lvl1_code IN ('HR','MATERIAL','MKT','RENT_UTIL','SHIP','ADMIN')
                  OR (lvl1_code='EXP_OTHER' AND lvl2_code <> 'BONUS'))
              THEN ABS(amount) ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM brand_gelatomiiix_dm.v_profit_statement GROUP BY month, store_code
),
-- cogs_agg: placeholder returns no rows. gelatomiiix has no inventory data yet.
-- Future commit: replace with `SELECT store_code, period, cogs_amt FROM brand_gelatomiiix_dm.v_cogs_monthly`
cogs_agg AS (
  SELECT NULL::text AS store_code, NULL::text AS period, NULL::numeric AS cogs_amt WHERE FALSE
),
cashflow_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END) AS operating_cf_amt,
    SUM(total_in)  AS total_in_amt,
    SUM(total_out) AS total_out_amt
  FROM brand_gelatomiiix_dm.v_cashflow_statement GROUP BY month, store_code
)
SELECT
  p.month, p.store_code,
  p.revenue_amt, p.cost_amt, p.expense_amt, p.hr_amt, p.rent_amt,
  cg.cogs_amt,
  CASE WHEN cg.cogs_amt IS NULL THEN NULL
       ELSE p.revenue_amt - cg.cogs_amt END AS gross_profit_amt,
  CASE WHEN cg.cogs_amt IS NULL THEN NULL
       ELSE p.revenue_amt - cg.cogs_amt - p.non_cogs_expense_amt END AS net_profit_amt,
  cf.operating_cf_amt, cf.total_in_amt, cf.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN cf.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(cf.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(ABS(p.hr_amt)::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(ABS(p.rent_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct,
  CASE WHEN cg.cogs_amt IS NULL OR p.revenue_amt = 0 THEN NULL
       ELSE ROUND((p.revenue_amt - cg.cogs_amt)::numeric / p.revenue_amt * 100, 1) END
    AS gross_profit_rate_pct,
  CASE WHEN cg.cogs_amt IS NULL OR p.revenue_amt = 0 THEN NULL
       ELSE ROUND((p.revenue_amt - cg.cogs_amt - p.non_cogs_expense_amt)::numeric / p.revenue_amt * 100, 1) END
    AS net_profit_rate_pct
FROM profit_agg p
LEFT JOIN cogs_agg cg
  ON cg.period = to_char(p.month, 'YYYY-MM') AND cg.store_code = p.store_code
LEFT JOIN cashflow_agg cf ON cf.month = p.month AND cf.store_code = p.store_code
LEFT JOIN brand_gelatomiiix_dm.v_balance_sheet b ON b.month = p.month AND b.store_code = p.store_code;

-- brand_tamkoko_dm (cogs basis, uses v_cogs_monthly)
--   - 成本/毛利/净利/毛利率/净利率：cogs 口径（v_cogs_monthly.cogs_amt 非 NULL 时）；
--   - 首期（opening_amt NULL → cogs_amt NULL）→ 以上指标返回 NULL；
--   - 其他列（cashflow / balance_sheet）保持原状。
-- 注意：列顺序与 bonjur/gelatomiiix 统一（cogs_amt 在 expense_amt 之后）。
DROP VIEW IF EXISTS brand_tamkoko_dm.v_store_monthly_kpi;
CREATE OR REPLACE VIEW brand_tamkoko_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN lvl1_code = 'MATERIAL' THEN ABS(amount) ELSE 0 END) AS cost_amt,
    -- non_cogs_expense_amt: HR + MKT + RENT_UTIL + SHIP + ADMIN + EXP_OTHER (excl. BONUS)
    SUM(CASE WHEN (lvl1_code IN ('HR','MKT','RENT_UTIL','SHIP','ADMIN')
                  OR (lvl1_code='EXP_OTHER' AND lvl2_code <> 'BONUS'))
              THEN ABS(amount) ELSE 0 END) AS non_cogs_expense_amt,
    -- expense_amt: kept for KPI card display (sum of all operating expenses incl. MATERIAL)
    SUM(CASE WHEN (lvl1_code IN ('HR','MATERIAL','MKT','RENT_UTIL','SHIP','ADMIN')
                  OR (lvl1_code='EXP_OTHER' AND lvl2_code <> 'BONUS'))
              THEN ABS(amount) ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM brand_tamkoko_dm.v_profit_statement GROUP BY month, store_code
),
cogs_agg AS (
  SELECT store_code, period, cogs_amt
  FROM brand_tamkoko_dm.v_cogs_monthly
),
cashflow_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END) AS operating_cf_amt,
    SUM(total_in)  AS total_in_amt,
    SUM(total_out) AS total_out_amt
  FROM brand_tamkoko_dm.v_cashflow_statement GROUP BY month, store_code
)
SELECT
  p.month, p.store_code,
  p.revenue_amt, p.cost_amt, p.expense_amt, p.hr_amt, p.rent_amt,
  cg.cogs_amt,
  CASE WHEN cg.cogs_amt IS NULL THEN NULL
       ELSE p.revenue_amt - cg.cogs_amt END AS gross_profit_amt,
  CASE WHEN cg.cogs_amt IS NULL THEN NULL
       ELSE p.revenue_amt - cg.cogs_amt - p.non_cogs_expense_amt END AS net_profit_amt,
  cf.operating_cf_amt, cf.total_in_amt, cf.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN cf.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(cf.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(ABS(p.hr_amt)::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(ABS(p.rent_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct,
  CASE WHEN cg.cogs_amt IS NULL OR p.revenue_amt = 0 THEN NULL
       ELSE ROUND((p.revenue_amt - cg.cogs_amt)::numeric / p.revenue_amt * 100, 1) END
    AS gross_profit_rate_pct,
  CASE WHEN cg.cogs_amt IS NULL OR p.revenue_amt = 0 THEN NULL
       ELSE ROUND((p.revenue_amt - cg.cogs_amt - p.non_cogs_expense_amt)::numeric / p.revenue_amt * 100, 1) END
    AS net_profit_rate_pct
FROM profit_agg p
LEFT JOIN cogs_agg cg
  ON cg.period = to_char(p.month, 'YYYY-MM') AND cg.store_code = p.store_code
LEFT JOIN cashflow_agg cf ON cf.month = p.month AND cf.store_code = p.store_code
LEFT JOIN brand_tamkoko_dm.v_balance_sheet b ON b.month = p.month AND b.store_code = p.store_code;
