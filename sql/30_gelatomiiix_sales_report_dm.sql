CREATE SCHEMA IF NOT EXISTS gelatomiiix_dm;

-- 日销售汇总
DROP VIEW IF EXISTS gelatomiiix_dm.v_daily_sales_report CASCADE;
CREATE VIEW gelatomiiix_dm.v_daily_sales_report AS
SELECT
  store_code, store_name, biz_date,
  SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
  SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
  SUM(COALESCE(discount_amt,0)) AS discount_amt,
  SUM(COALESCE(net_amt,0)) AS net_amt,
  COUNT(DISTINCT order_no) AS order_cnt,
  CASE WHEN COUNT(DISTINCT order_no) > 0
    THEN ROUND(SUM(COALESCE(gross_amt,0)) / COUNT(DISTINCT order_no), 2)
    ELSE NULL
  END AS avg_order_amt
FROM gelatomiiix_ods.cash_register_detail
GROUP BY store_code, store_name, biz_date;

-- 月销售汇总（含环比）
DROP VIEW IF EXISTS gelatomiiix_dm.v_monthly_sales_report CASCADE;
CREATE VIEW gelatomiiix_dm.v_monthly_sales_report AS
SELECT
  store_code, store_name,
  DATE_TRUNC('month', biz_date)::DATE AS month,
  SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
  SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
  SUM(COALESCE(discount_amt,0)) AS discount_amt,
  SUM(COALESCE(net_amt,0)) AS net_amt,
  COUNT(DISTINCT order_no) AS order_cnt,
  LAG(SUM(COALESCE(gross_amt,0)))
    OVER (PARTITION BY store_code ORDER BY DATE_TRUNC('month', biz_date))
    AS prev_month_gross_sales_amt
FROM gelatomiiix_ods.cash_register_detail
GROUP BY store_code, store_name, DATE_TRUNC('month', biz_date);

-- 商品 Top N
DROP VIEW IF EXISTS gelatomiiix_dm.v_product_top_sales CASCADE;
CREATE VIEW gelatomiiix_dm.v_product_top_sales AS
SELECT
  store_code, store_name, product_name,
  SUM(COALESCE(qty,0)) AS total_qty,
  SUM(COALESCE(sales_amt,0)) AS total_sales_amt,
  SUM(COALESCE(received_amt,0)) AS total_received_amt,
  SUM(COALESCE(discount_amt,0)) AS total_discount_amt,
  RANK() OVER (PARTITION BY store_code ORDER BY SUM(COALESCE(sales_amt,0)) DESC) AS sales_rank,
  RANK() OVER (PARTITION BY store_code ORDER BY SUM(COALESCE(qty,0)) DESC) AS qty_rank
FROM gelatomiiix_ods.product_sales_detail
GROUP BY store_code, store_name, product_name;

-- 支付渠道拆分
DROP VIEW IF EXISTS gelatomiiix_dm.v_payment_channel_breakdown CASCADE;
CREATE VIEW gelatomiiix_dm.v_payment_channel_breakdown AS
SELECT
  store_code, store_name, biz_date,
  payment_method,
  COUNT(*) AS txn_cnt,
  SUM(COALESCE(gross_amt,0)) AS gross_amt,
  SUM(COALESCE(revenue_amt,0)) AS revenue_amt
FROM gelatomiiix_ods.cash_register_detail
GROUP BY store_code, store_name, biz_date, payment_method;
