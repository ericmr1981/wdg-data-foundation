-- Gelatomiiix | 蜜可诗 产品规格销售分析
-- 从 product_name 解析出规格分类，支持按规格/产品名两个粒度聚合
-- 规格规则(按优先级)：
--   华夫蛋筒 → 含「蛋筒」「华夫」
--   杯装 → 含「冰杯」或结尾「杯」
--   碗装 → 含「碗」
--   成品/预包装 → 含「成品」
--   桶装 → 含「桶」
--   糖果 → 含「牛轧糖」
--   特惠装 → 含「特惠」
--   迷你装 → 含「迷你」
--   烘焙 → 含「曲奇」「碱水结」「黄油」
--   画板 → 含「画板」
--   牛乳/饮品 → 含「牛奶」
--   其他 → 现场单球

CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_sales_product_analysis AS
WITH prod AS (
    SELECT store_code, order_no, biz_date, product_name, unit_price, qty, sales_amt, received_amt, discount_amt, order_hour,
        CASE
            WHEN product_name LIKE '%蛋筒%' OR product_name LIKE '%华夫%' THEN '华夫蛋筒'
            WHEN product_name LIKE '%冰杯%' OR product_name LIKE '%冰杯' THEN '杯装'
            WHEN product_name LIKE '%杯' AND product_name NOT LIKE '%特惠%' THEN '杯装'
            WHEN product_name LIKE '%碗%' THEN '碗装'
            WHEN product_name LIKE '%成品%' THEN '成品/预包装'
            WHEN product_name LIKE '%桶%' THEN '桶装'
            WHEN product_name LIKE '%牛轧糖%' THEN '糖果'
            WHEN product_name LIKE '%特惠%' THEN '特惠装'
            WHEN product_name LIKE '%迷你%' THEN '迷你装'
            WHEN product_name LIKE '%曲奇%' OR product_name LIKE '%碱水结%' OR product_name LIKE '%黄油%' THEN '烘焙'
            WHEN product_name LIKE '%画板%' THEN '画板'
            WHEN product_name LIKE '%牛奶%' OR product_name LIKE '%牛乳%' THEN '牛乳/饮品'
            ELSE '现场单球'
        END AS spec_category
    FROM gelatomiiix_ods.product_sales_detail
)
SELECT store_code, biz_date, spec_category, product_name, unit_price,
    SUM(qty) AS total_qty,
    SUM(sales_amt) AS total_sales,
    SUM(received_amt) AS total_received,
    SUM(discount_amt) AS total_discount,
    CASE WHEN SUM(sales_amt) > 0 THEN ROUND(100.0 * SUM(received_amt) / SUM(sales_amt), 2) ELSE 0 END AS cash_in_rate_pct
FROM prod
GROUP BY store_code, biz_date, spec_category, product_name, unit_price;
