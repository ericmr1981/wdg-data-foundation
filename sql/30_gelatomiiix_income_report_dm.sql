-- gelatomiiix DM 层报表视图（基于收入明细表 income_detail）
-- 替换: v_daily_sales_report, v_monthly_sales_report, v_payment_channel_breakdown

------------------------------------------------------------
-- 日销售汇总
------------------------------------------------------------
DROP VIEW IF EXISTS gelatomiiix_dm.v_daily_sales_report CASCADE;
CREATE VIEW gelatomiiix_dm.v_daily_sales_report AS
SELECT
  store_code,
  store_name,
  biz_date,
  SUM(gross_amt)    AS gross_sales_amt,
  SUM(revenue_amt)  AS revenue_amt,
  SUM(discount_amt) AS discount_amt,
  SUM(net_amt)      AS net_amt,
  COUNT(DISTINCT order_no_clean)          AS order_cnt,
  CASE
    WHEN COUNT(DISTINCT order_no_clean) > 0
    THEN ROUND(SUM(gross_amt) / COUNT(DISTINCT order_no_clean), 2)
    ELSE NULL
  END AS avg_order_amt
FROM gelatomiiix_ods.income_detail
GROUP BY store_code, store_name, biz_date;

------------------------------------------------------------
-- 月销售汇总（含环比）
------------------------------------------------------------
DROP VIEW IF EXISTS gelatomiiix_dm.v_monthly_sales_report CASCADE;
CREATE VIEW gelatomiiix_dm.v_monthly_sales_report AS
SELECT
  store_code,
  store_name,
  DATE_TRUNC('month', biz_date)::DATE AS month,
  SUM(gross_amt)    AS gross_sales_amt,
  SUM(revenue_amt)  AS revenue_amt,
  SUM(discount_amt) AS discount_amt,
  SUM(net_amt)      AS net_amt,
  COUNT(DISTINCT order_no_clean) AS order_cnt,
  LAG(SUM(gross_amt))
    OVER (PARTITION BY store_code ORDER BY DATE_TRUNC('month', biz_date))
    AS prev_month_gross_sales_amt
FROM gelatomiiix_ods.income_detail
GROUP BY store_code, store_name, DATE_TRUNC('month', biz_date);

------------------------------------------------------------
-- 支付渠道拆分
-- 展开 payment_methods 数组，每个支付方式单独一行
------------------------------------------------------------
DROP VIEW IF EXISTS gelatomiiix_dm.v_payment_channel_breakdown CASCADE;
CREATE VIEW gelatomiiix_dm.v_payment_channel_breakdown AS
SELECT
  store_code,
  store_name,
  biz_date,
  ch AS payment_method,
  COUNT(*) AS txn_cnt,
  SUM(revenue_amt) AS gross_amt,
  SUM(net_amt)    AS revenue_amt
FROM gelatomiiix_ods.income_detail,
     unnest(COALESCE(payment_methods, ARRAY[]::TEXT[])) WITH ORDINALITY AS t(ch, ord)
GROUP BY store_code, store_name, biz_date, ch, t.ord;

------------------------------------------------------------
-- 会员支付 vs 第三方支付汇总（日维度）
-- 用于区分入账率和非入账收入
------------------------------------------------------------
DROP VIEW IF EXISTS gelatomiiix_dm.v_revenue_bankability_daily CASCADE;
CREATE VIEW gelatomiiix_dm.v_revenue_bankability_daily AS
SELECT
  store_code,
  store_name,
  biz_date,
  -- 第三方支付（含银行入账）
  SUM(CASE WHEN NOT is_member_payment THEN revenue_amt ELSE 0 END) AS third_party_revenue_amt,
  SUM(CASE WHEN NOT is_member_payment AND '微信支付' = ANY(COALESCE(payment_methods, ARRAY[]::TEXT[]))
       THEN revenue_amt ELSE 0 END) AS wechat_revenue_amt,
  SUM(CASE WHEN NOT is_member_payment AND '支付宝支付' = ANY(COALESCE(payment_methods, ARRAY[]::TEXT[]))
       THEN revenue_amt ELSE 0 END) AS alipay_revenue_amt,
  SUM(CASE WHEN NOT is_member_payment AND '美团团购券' = ANY(COALESCE(payment_methods, ARRAY[]::TEXT[]))
       THEN revenue_amt ELSE 0 END) AS meituan_revenue_amt,
  SUM(CASE WHEN NOT is_member_payment AND '云闪付' = ANY(COALESCE(payment_methods, ARRAY[]::TEXT[]))
       THEN revenue_amt ELSE 0 END) AS unionpay_revenue_amt,
  SUM(CASE WHEN NOT is_member_payment AND '抖音团购券' = ANY(COALESCE(payment_methods, ARRAY[]::TEXT[]))
       THEN revenue_amt ELSE 0 END) AS douyin_revenue_amt,
  SUM(CASE WHEN NOT is_member_payment THEN net_amt ELSE 0 END) AS third_party_net_amt,
  -- 会员支付（不入银行）
  SUM(CASE WHEN is_member_payment THEN revenue_amt ELSE 0 END) AS member_revenue_amt,
  SUM(CASE WHEN is_member_payment THEN net_amt ELSE 0 END) AS member_net_amt,
  -- 总计
  SUM(revenue_amt) AS total_revenue_amt,
  SUM(net_amt)     AS total_net_amt,
  COUNT(DISTINCT order_no_clean) AS order_cnt
FROM gelatomiiix_ods.income_detail
WHERE NOT is_refund
GROUP BY store_code, store_name, biz_date;