-- Tamkoko | 收银明细 按餐段月度汇总
-- 餐段: 早市 / 午市 / 晚市 / 未分类(meal_period IS NULL)
-- 输出: 每 (store_code, month, meal_period) 一行

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_cash_register_meal_period_overview AS
WITH base AS (
    SELECT
        store_code,
        date_trunc('month', biz_date)::date AS month,
        COALESCE(NULLIF(meal_period, ''), '未分类') AS meal_period,
        gross_amt,
        revenue_amt,
        discount_amt,
        net_amt,
        qty
    FROM brand_tamkoko_ods.cash_register_order
),
agg AS (
    SELECT
        store_code,
        month,
        meal_period,
        SUM(gross_amt)    AS gross_amt,
        SUM(revenue_amt)  AS revenue_amt,
        SUM(discount_amt) AS discount_amt,
        SUM(net_amt)      AS net_amt,
        SUM(qty)          AS qty,
        COUNT(*)          AS order_cnt
    FROM base
    GROUP BY store_code, month, meal_period
)
SELECT
    store_code,
    month,
    meal_period,
    gross_amt,
    revenue_amt,
    discount_amt,
    net_amt,
    qty,
    order_cnt,
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(net_amt      / NULLIF(gross_amt, 0), 6) AS profit_rate,
    ROUND(gross_amt    / NULLIF(order_cnt, 0), 2)      AS avg_order_amt,
    ROUND(100.0 * revenue_amt / NULLIF(gross_amt, 0), 2) AS cash_in_rate_pct,
    ROUND(100.0 * net_amt      / NULLIF(gross_amt, 0), 2) AS profit_rate_pct
FROM agg;
