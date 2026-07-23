CREATE OR REPLACE VIEW bonjur_dm.v_sales_daily AS
WITH base AS (
    SELECT store_code, biz_date, gross_amt, revenue_amt, net_amt
    FROM bonjur_ods.income_detail WHERE NOT is_refund
),
agg AS (
    SELECT store_code, biz_date, SUM(gross_amt) AS gross_amt, SUM(revenue_amt) AS revenue_amt,
        SUM(net_amt) AS net_amt, COUNT(*) AS order_cnt
    FROM base GROUP BY store_code, biz_date
)
SELECT store_code, biz_date, gross_amt, revenue_amt, net_amt, order_cnt,
    ROUND(revenue_amt/NULLIF(gross_amt,0),6) AS cash_in_rate,
    ROUND(net_amt/NULLIF(gross_amt,0),6) AS profit_rate,
    ROUND(gross_amt/NULLIF(order_cnt,0),2) AS avg_order_amt,
    ROUND(100.0*revenue_amt/NULLIF(gross_amt,0),2) AS cash_in_rate_pct,
    ROUND(100.0*net_amt/NULLIF(gross_amt,0),2) AS profit_rate_pct
FROM agg;
