-- Tamkoko | 收银明细 月度 KPI 概览
-- 输入: brand_tamkoko_ods.cash_register_order(净订单粒度)
-- 输出: 每 (store_code, month) 一行,含核心 KPI 与环比

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_cash_register_overview AS
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
    -- KPI (引用 agg 已聚合列,不再 SUM)
    ROUND(revenue_amt / NULLIF(gross_amt, 0), 6) AS cash_in_rate,
    ROUND(net_amt      / NULLIF(gross_amt, 0), 6) AS profit_rate,
    ROUND(discount_amt / NULLIF(gross_amt, 0), 6) AS discount_rate,
    ROUND(gross_amt    / NULLIF(order_cnt, 0), 2) AS avg_order_amt,
    -- 上一期
    LAG(gross_amt)    OVER (PARTITION BY store_code ORDER BY month) AS prev_gross_amt,
    LAG(revenue_amt)  OVER (PARTITION BY store_code ORDER BY month) AS prev_revenue_amt,
    LAG(net_amt)      OVER (PARTITION BY store_code ORDER BY month) AS prev_net_amt,
    LAG(order_cnt)    OVER (PARTITION BY store_code ORDER BY month) AS prev_order_cnt,
    -- 环比变化
    ROUND(100.0 * (gross_amt    - LAG(gross_amt)   OVER w) / NULLIF(LAG(gross_amt)   OVER w, 0), 2) AS gross_mom_pct,
    ROUND(100.0 * (revenue_amt  - LAG(revenue_amt) OVER w) / NULLIF(LAG(revenue_amt) OVER w, 0), 2) AS revenue_mom_pct,
    ROUND(100.0 * (net_amt      - LAG(net_amt)     OVER w) / NULLIF(LAG(net_amt)     OVER w, 0), 2) AS net_mom_pct,
    ROUND(100.0 * (order_cnt    - LAG(order_cnt)   OVER w) / NULLIF(LAG(order_cnt)   OVER w, 0), 2) AS order_cnt_mom_pct,
    -- 百分比形式
    ROUND(100.0 * revenue_amt / NULLIF(gross_amt, 0), 2) AS cash_in_rate_pct,
    ROUND(100.0 * net_amt      / NULLIF(gross_amt, 0), 2) AS profit_rate_pct,
    ROUND(100.0 * discount_amt / NULLIF(gross_amt, 0), 2) AS discount_rate_pct
FROM agg
WINDOW w AS (PARTITION BY store_code ORDER BY month);