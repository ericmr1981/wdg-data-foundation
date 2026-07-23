-- Gelatomiiix | 蜜可诗 商品销售排行
-- 源: gelatomiiix_ods.product_sales_detail
-- 输出: 每 (store_code, month, product_name) 一行

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_product AS
WITH base AS (
    SELECT
        store_code,
        date_trunc('month', biz_date)::date AS month,
        product_name,
        qty,
        sales_amt,
        received_amt,
        discount_amt
    FROM gelatomiiix_ods.product_sales_detail
),
agg AS (
    SELECT
        store_code,
        month,
        product_name,
        SUM(qty)           AS total_qty,
        SUM(sales_amt)     AS total_sales,
        SUM(received_amt)  AS total_received,
        SUM(discount_amt)  AS total_discount
    FROM base
    GROUP BY store_code, month, product_name
)
SELECT
    store_code,
    month,
    product_name,
    total_qty,
    total_sales,
    total_received,
    total_discount,
    ROUND(total_received / NULLIF(total_sales, 0), 6) AS cash_in_rate,
    ROUND(100.0 * total_received / NULLIF(total_sales, 0), 2) AS cash_in_rate_pct
FROM agg;
