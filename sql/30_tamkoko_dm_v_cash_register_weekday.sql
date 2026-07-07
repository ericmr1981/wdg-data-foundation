-- Tamkoko | 收银明细 按周+星期几
-- 输出: 每 (store_code, week_start, weekday) 一行
--   weekday: 0=周日 ... 6=周六(PG EXTRACT(dow))
--   week_start: 该周周一日期

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_cash_register_weekday AS
WITH base AS (
    SELECT
        store_code,
        biz_date,
        EXTRACT(dow FROM biz_date)::int AS weekday,
        date_trunc('week', biz_date)::date AS week_start,
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
        week_start,
        weekday,
        SUM(gross_amt)    AS gross_amt,
        SUM(revenue_amt)  AS revenue_amt,
        SUM(discount_amt) AS discount_amt,
        SUM(net_amt)      AS net_amt,
        SUM(qty)          AS qty,
        COUNT(*)          AS order_cnt
    FROM base
    GROUP BY store_code, week_start, weekday
)
SELECT
    store_code,
    week_start,
    weekday,
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
FROM agg
GROUP BY store_code, week_start, weekday, gross_amt, revenue_amt, discount_amt, net_amt, qty, order_cnt;
