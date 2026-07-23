-- Gelatomiiix | 蜜可诗 产品规格销售分析（两级）
-- 一级规格 = product_name 括号前部分（去掉反引号）
-- 二级规格 = 括号内容，无括号则为 "标准"

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_spec_overview AS
WITH base AS (
    SELECT store_code, date_trunc('month', biz_date)::date AS month, qty, sales_amt, received_amt, discount_amt,
        CASE 
            WHEN position('（' in product_name) > 0 THEN 
                trim(leading '`' from substring(product_name from 1 for position('（' in product_name) - 1))
            WHEN position('(' in product_name) > 0 THEN 
                trim(leading '`' from substring(product_name from 1 for position('(' in product_name) - 1))
            ELSE trim(leading '`' from product_name)
        END AS spec_level1,
        CASE 
            WHEN position('（' in product_name) > 0 THEN 
                substring(product_name from position('（' in product_name) + 1 for 
                    position('）' in product_name) - position('（' in product_name) - 1)
            WHEN position('(' in product_name) > 0 THEN 
                substring(product_name from position('(' in product_name) + 1 for 
                    position(')' in product_name) - position('(' in product_name) - 1)
            ELSE '标准'
        END AS spec_level2
    FROM gelatomiiix_ods.product_sales_detail
)
SELECT 
    CASE 
        WHEN spec_level1 LIKE '%蛋筒%' OR spec_level1 LIKE '%华夫%' THEN '华夫蛋筒'
        WHEN spec_level1 LIKE '%冰杯%' OR spec_level1 LIKE '%杯' THEN '杯装'
        WHEN spec_level1 LIKE '%碗%' THEN '碗装'
        WHEN spec_level1 LIKE '%成品%' THEN '成品/预包装'
        WHEN spec_level1 LIKE '%桶%' THEN '桶装'
        WHEN spec_level1 LIKE '%牛轧糖%' THEN '糖果'
        WHEN spec_level1 LIKE '%特惠%' THEN '特惠装'
        WHEN spec_level1 LIKE '%迷你%' THEN '迷你装'
        WHEN spec_level1 LIKE '%曲奇%' OR spec_level1 LIKE '%碱水结%' OR spec_level1 LIKE '%黄油%' THEN '烘焙'
        WHEN spec_level1 LIKE '%画板%' THEN '画板'
        WHEN spec_level1 LIKE '%牛奶%' OR spec_level1 LIKE '%牛乳%' THEN '牛乳/饮品'
        WHEN spec_level1 LIKE '%水%' AND spec_level1 LIKE '%g%' THEN '饮品'
        ELSE '现场单球'
    END AS spec_category,
    spec_level2,
    SUM(qty) AS total_qty,
    SUM(sales_amt) AS total_sales,
    SUM(received_amt) AS total_received,
    SUM(discount_amt) AS total_discount,
    CASE WHEN SUM(sales_amt) > 0 THEN ROUND(100.0 * SUM(received_amt) / NULLIF(SUM(sales_amt), 0), 2) ELSE 0 END AS cash_in_rate_pct,
    COUNT(*) AS product_count
FROM base
GROUP BY spec_category, spec_level2;
