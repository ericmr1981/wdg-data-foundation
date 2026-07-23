-- Bonjur | 旺鼎阁 按订单来源(渠道)分布
-- 源: bonjur_ods.income_detail, order_source 为文本字段

CREATE OR REPLACE VIEW bonjur_dm.v_sales_channel AS
WITH base AS (
    SELECT store_code, date_trunc('month', biz_date)::date AS month,
        COALESCE(NULLIF(order_source, ''), '其他') AS channel, gross_amt, revenue_amt
    FROM bonjur_ods.income_detail WHERE NOT is_refund
),
agg AS (
    SELECT store_code, month, channel,
        SUM(gross_amt) AS gross_amt, SUM(revenue_amt) AS revenue_amt, COUNT(*) AS order_cnt
    FROM base GROUP BY store_code, month, channel
)
SELECT store_code, month, channel, gross_amt, revenue_amt, order_cnt,
    ROUND(revenue_amt/NULLIF(gross_amt,0),6) AS cash_in_rate,
    ROUND(gross_amt/NULLIF(order_cnt,0),2) AS avg_order_amt,
    ROUND(100.0*revenue_amt/NULLIF(gross_amt,0),2) AS cash_in_rate_pct
FROM agg;

CREATE OR REPLACE VIEW bonjur_dm.v_sales_dine_takeaway AS
WITH base AS (
    SELECT store_code, date_trunc('month', biz_date)::date AS month,
        COALESCE(NULLIF(order_type, ''), '未知') AS order_type, gross_amt, revenue_amt
    FROM bonjur_ods.income_detail WHERE NOT is_refund
),
agg AS (
    SELECT store_code, month, order_type,
        SUM(gross_amt) AS gross_amt, SUM(revenue_amt) AS revenue_amt, COUNT(*) AS order_cnt
    FROM base GROUP BY store_code, month, order_type
)
SELECT store_code, month, order_type, gross_amt, revenue_amt, order_cnt,
    ROUND(revenue_amt/NULLIF(gross_amt,0),6) AS cash_in_rate,
    ROUND(100.0*revenue_amt/NULLIF(gross_amt,0),2) AS cash_in_rate_pct
FROM agg;

CREATE OR REPLACE VIEW bonjur_dm.v_sales_trend AS
SELECT store_code, month, gross_amt, revenue_amt, net_amt, order_cnt,
    cash_in_rate, profit_rate, avg_order_amt, cash_in_rate_pct, profit_rate_pct
FROM bonjur_dm.v_sales_overview
WHERE month >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months';

CREATE OR REPLACE VIEW bonjur_dm.v_sales_product AS
WITH base AS (
    SELECT store_code, date_trunc('month', biz_date)::date AS month, product_name,
        qty, sales_amt, received_amt
    FROM bonjur_ods.product_sales_detail
),
agg AS (
    SELECT store_code, month, product_name,
        SUM(qty) AS total_qty, SUM(sales_amt) AS total_sales, SUM(received_amt) AS total_received
    FROM base GROUP BY store_code, month, product_name
)
SELECT store_code, month, product_name, total_qty, total_sales, total_received,
    ROUND(total_received/NULLIF(total_sales,0),6) AS cash_in_rate,
    ROUND(100.0*total_received/NULLIF(total_sales,0),2) AS cash_in_rate_pct
FROM agg;
