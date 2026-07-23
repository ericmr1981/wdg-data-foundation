-- Gelatomiiix | 蜜可诗 销售12月趋势
-- 直接读 v_sales_overview, 取最近12个月

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_trend AS
SELECT
    store_code,
    month,
    gross_amt,
    revenue_amt,
    discount_amt,
    net_amt,
    order_cnt,
    cash_in_rate,
    profit_rate,
    discount_rate,
    avg_order_amt,
    cash_in_rate_pct,
    profit_rate_pct,
    discount_rate_pct
FROM brand_gelatomiiix_dm.v_sales_overview
WHERE month >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months';
