-- ============================================================
-- v_store_monthly_kpi: 门店月报专用视图
-- 一行 = (品牌 schema 内) 1 月 × 1 门店，9 个核心财务指标 + 中间量
-- 依赖：v_profit_statement / v_cashflow_statement / v_balance_sheet
-- 适用：bonjur_dm / brand_gelatomiiix_dm / brand_tamkoko_dm
-- ============================================================

-- bonjur_dm
CREATE OR REPLACE VIEW bonjur_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END) AS cost_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code NOT IN ('EXP_OTHER', 'TAX_SURCHARGE', 'BUILD') THEN ABS(amount) ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM bonjur_dm.v_profit_statement GROUP BY month, store_code
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
  p.revenue_amt - p.cost_amt AS gross_profit_amt,
  p.revenue_amt - p.expense_amt AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(ABS(p.hr_amt)::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(ABS(p.rent_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct,
  ROUND((p.revenue_amt - p.cost_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS gross_profit_rate_pct,
  ROUND((p.revenue_amt - p.expense_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS net_profit_rate_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN bonjur_dm.v_balance_sheet b USING (month, store_code);

-- brand_gelatomiiix_dm
CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END) AS cost_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code NOT IN ('EXP_OTHER', 'TAX_SURCHARGE', 'BUILD') THEN ABS(amount) ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM brand_gelatomiiix_dm.v_profit_statement GROUP BY month, store_code
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
  p.revenue_amt - p.cost_amt AS gross_profit_amt,
  p.revenue_amt - p.expense_amt AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(ABS(p.hr_amt)::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(ABS(p.rent_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct,
  ROUND((p.revenue_amt - p.cost_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS gross_profit_rate_pct,
  ROUND((p.revenue_amt - p.expense_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS net_profit_rate_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN brand_gelatomiiix_dm.v_balance_sheet b USING (month, store_code);

-- brand_tamkoko_dm
CREATE OR REPLACE VIEW brand_tamkoko_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END) AS cost_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code NOT IN ('EXP_OTHER', 'TAX_SURCHARGE', 'BUILD') THEN ABS(amount) ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM brand_tamkoko_dm.v_profit_statement GROUP BY month, store_code
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
  p.revenue_amt - p.cost_amt AS gross_profit_amt,
  p.revenue_amt - p.expense_amt AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(ABS(p.hr_amt)::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(ABS(p.rent_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct,
  ROUND((p.revenue_amt - p.cost_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS gross_profit_rate_pct,
  ROUND((p.revenue_amt - p.expense_amt)::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS net_profit_rate_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN brand_tamkoko_dm.v_balance_sheet b USING (month, store_code);
