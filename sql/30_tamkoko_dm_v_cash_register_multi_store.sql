-- Tamkoko | 收银明细 多门店月度对比
-- 输出: 每 (month, store_code) 一行
-- (不同于 overview 之处:partition 不含 store_code,可跨店对比)

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_cash_register_multi_store AS
WITH base AS (
    SELECT
        store_code,
        date_trunc('month', biz_date)::date AS month,
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
        SUM(gross_amt)    AS gross_amt,
        SUM(revenue_amt)  AS revenue_amt,
        SUM(discount_amt) AS discount_amt,
        SUM(net_amt)      AS net_amt,
        SUM(qty)          AS qty,
        COUNT(*)          AS order_cnt
    FROM base
    GROUP BY store_code, month
)
SELECT
    store_code,
    month,
    gross_amt,
    revenue_amt,
    discount_amt,
    net_amt,
    qty,
    order_cnt,
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(net_amt      / NULLIF(gross_amt, 0), 6) AS profit_rate,
    ROUND(gross_amt    / NULLIF(order_cnt, 0), 2)      AS avg_order_amt,
    -- 跨店 rank(同月按 gross desc)
    RANK() OVER (PARTITION BY month ORDER BY gross_amt DESC) AS gross_rank_in_month,
    ROUND(100.0 * revenue_amt / NULLIF(gross_amt, 0), 2) AS cash_in_rate_pct,
    ROUND(100.0 * net_amt      / NULLIF(gross_amt, 0), 2) AS profit_rate_pct
FROM agg
GROUP BY store_code, month, gross_amt, revenue_amt, discount_amt, net_amt, qty, order_cnt;
