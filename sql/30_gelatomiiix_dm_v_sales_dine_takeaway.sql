-- Gelatomiiix | 蜜可诗 按用餐类型(堂食/打包)分布

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_dine_takeaway AS
WITH base AS (
    SELECT
        store_code,
        date_trunc('month', biz_date)::date AS month,
        COALESCE(NULLIF(order_type, ''), '未知') AS order_type,
        gross_amt,
        revenue_amt
    FROM gelatomiiix_ods.income_detail
    WHERE NOT is_refund
),
agg AS (
    SELECT
        store_code,
        month,
        order_type,
        SUM(gross_amt)    AS gross_amt,
        SUM(revenue_amt)  AS revenue_amt,
        COUNT(*)          AS order_cnt
    FROM base
    GROUP BY store_code, month, order_type
)
SELECT
    store_code,
    month,
    order_type,
    gross_amt,
    revenue_amt,
    order_cnt,
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(100.0 * revenue_amt / NULLIF(gross_amt, 0), 2) AS cash_in_rate_pct
FROM agg;
