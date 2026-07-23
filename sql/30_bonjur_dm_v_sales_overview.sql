-- Bonjur | 旺鼎阁 销售月度 KPI 概览
-- 源: bonjur_ods.income_detail (WHERE NOT is_refund)
-- 无 discount_amt 字段, 其余与 gelatomiiix 同模式

CREATE OR REPLACE VIEW bonjur_dm.v_sales_overview AS
WITH base AS (
    SELECT store_code, date_trunc('month', biz_date)::date AS month, gross_amt, revenue_amt, net_amt
    FROM bonjur_ods.income_detail WHERE NOT is_refund
),
agg AS (
    SELECT store_code, month, SUM(gross_amt) AS gross_amt, SUM(revenue_amt) AS revenue_amt,
        SUM(net_amt) AS net_amt, COUNT(*) AS order_cnt
    FROM base GROUP BY store_code, month
)
SELECT store_code, month, gross_amt, revenue_amt, net_amt, order_cnt,
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(net_amt / NULLIF(gross_amt, 0), 6) AS profit_rate,
    ROUND(gross_amt / NULLIF(order_cnt, 0), 2) AS avg_order_amt,
    LAG(gross_amt) OVER w AS prev_gross_amt, LAG(revenue_amt) OVER w AS prev_revenue_amt,
    LAG(net_amt) OVER w AS prev_net_amt, LAG(order_cnt) OVER w AS prev_order_cnt,
    ROUND(100.0*(gross_amt-LAG(gross_amt) OVER w)/NULLIF(LAG(gross_amt) OVER w,0),2) AS gross_mom_pct,
    ROUND(100.0*(revenue_amt-LAG(revenue_amt) OVER w)/NULLIF(LAG(revenue_amt) OVER w,0),2) AS revenue_mom_pct,
    ROUND(100.0*(net_amt-LAG(net_amt) OVER w)/NULLIF(LAG(net_amt) OVER w,0),2) AS net_mom_pct,
    ROUND(100.0*(order_cnt-LAG(order_cnt) OVER w)/NULLIF(LAG(order_cnt) OVER w,0),2) AS order_cnt_mom_pct,
    ROUND(100.0*revenue_amt/NULLIF(gross_amt,0),2) AS cash_in_rate_pct,
    ROUND(100.0*net_amt/NULLIF(gross_amt,0),2) AS profit_rate_pct
FROM agg WINDOW w AS (PARTITION BY store_code ORDER BY month);
