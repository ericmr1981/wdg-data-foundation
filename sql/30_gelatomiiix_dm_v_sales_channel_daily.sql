-- Gelatomiiix | 蜜可诗 支付方式日级趋势
-- 按 (store_code, biz_date, channel) 聚合，用于每日各渠道堆叠折线图
-- channel = unnest(payment_methods)，NULL 保留为 '其他'

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_channel_daily AS
WITH base AS (
    SELECT store_code, biz_date, COALESCE(pm, '其他') AS channel, gross_amt, revenue_amt
    FROM gelatomiiix_ods.income_detail
    LEFT JOIN LATERAL unnest(payment_methods) AS pm ON true
    WHERE NOT is_refund
),
agg AS (
    SELECT store_code, biz_date, channel,
        SUM(gross_amt) AS gross_amt,
        SUM(revenue_amt) AS revenue_amt,
        COUNT(*) AS order_cnt
    FROM base GROUP BY store_code, biz_date, channel
)
SELECT store_code, biz_date, channel, gross_amt, revenue_amt, order_cnt
FROM agg;
