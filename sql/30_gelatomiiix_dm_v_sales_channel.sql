-- Gelatomiiix | 蜜可诗 按支付渠道分布
-- 源: gelatomiiix_ods.income_detail, payment_methods 为 ARRAY, 用 unnest 展开
-- NULL payment_methods → 标记为 '其他'

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_channel AS
WITH base AS (
    SELECT
        store_code,
        date_trunc('month', biz_date)::date AS month,
        COALESCE(pm, '其他') AS channel,
        gross_amt,
        revenue_amt
    FROM gelatomiiix_ods.income_detail
    LEFT JOIN LATERAL unnest(payment_methods) AS pm ON true
    WHERE NOT is_refund
),
agg AS (
    SELECT
        store_code,
        month,
        channel,
        SUM(gross_amt)    AS gross_amt,
        SUM(revenue_amt)  AS revenue_amt,
        COUNT(*)          AS order_cnt
    FROM base
    GROUP BY store_code, month, channel
)
SELECT
    store_code,
    month,
    channel,
    gross_amt,
    revenue_amt,
    order_cnt,
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(gross_amt    / NULLIF(order_cnt, 0), 2) AS avg_order_amt,
    ROUND(100.0 * revenue_amt / NULLIF(gross_amt, 0), 2) AS cash_in_rate_pct
FROM agg;
