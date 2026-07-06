-- Tamkoko | 收银明细 按订单来源(渠道)分布
-- 输出: 每 (store_code, month, order_source) 一行,带环比

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_cash_register_channel AS
WITH base AS (
    SELECT
        store_code,
        date_trunc('month', biz_date)::date AS month,
        order_source,
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
        order_source,
        SUM(gross_amt)    AS gross_amt,
        SUM(revenue_amt)  AS revenue_amt,
        SUM(discount_amt) AS discount_amt,
        SUM(net_amt)      AS net_amt,
        SUM(qty)          AS qty,
        COUNT(*)          AS order_cnt
    FROM base
    GROUP BY store_code, month, order_source
)
SELECT
    store_code,
    month,
    order_source,
    gross_amt,
    revenue_amt,
    discount_amt,
    net_amt,
    qty,
    order_cnt,
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(net_amt      / NULLIF(gross_amt, 0), 6) AS profit_rate,
    ROUND(gross_amt    / NULLIF(order_cnt, 0), 2)      AS avg_order_amt,
    LAG(gross_amt)   OVER (PARTITION BY store_code, order_source ORDER BY month) AS prev_gross_amt,
    LAG(revenue_amt) OVER (PARTITION BY store_code, order_source ORDER BY month) AS prev_revenue_amt,
    ROUND(100.0 * (gross_amt   - LAG(gross_amt)   OVER w) / NULLIF(LAG(gross_amt)   OVER w, 0), 2) AS gross_mom_pct,
    ROUND(100.0 * (revenue_amt - LAG(revenue_amt) OVER w) / NULLIF(LAG(revenue_amt) OVER w, 0), 2) AS revenue_mom_pct,
    ROUND(100.0 * revenue_amt / NULLIF(gross_amt, 0), 2) AS cash_in_rate_pct,
    ROUND(100.0 * net_amt      / NULLIF(gross_amt, 0), 2) AS profit_rate_pct
FROM agg
WINDOW w AS (PARTITION BY store_code, order_source ORDER BY month);
