-- Bonjur｜营业数据（自助下载明细）DM Views

create schema if not exists bonjur_dm;

-- Base daily report view
DROP VIEW IF EXISTS bonjur_dm.sales_daily_report_v1 CASCADE;

CREATE VIEW bonjur_dm.sales_daily_report_v1 AS
SELECT
  store_code,
  store_name,
  biz_date,
  month,

  gross_sales_amt,
  revenue_amt,
  order_cnt,
  refund_amt,
  revenue_incl_service_fee_amt,
  platform_service_fee_amt,

  -- Derived KPIs
  CASE WHEN COALESCE(gross_sales_amt,0) > 0
    THEN ROUND(COALESCE(revenue_amt,0) / gross_sales_amt, 6)
    ELSE NULL
  END AS cash_in_rate,                 -- 实收率（0-1）

  CASE WHEN COALESCE(gross_sales_amt,0) > 0
    THEN ROUND(100.0 * COALESCE(revenue_amt,0) / gross_sales_amt, 2)
    ELSE NULL
  END AS cash_in_rate_pct,             -- 实收率（百分比）

  COALESCE(gross_sales_amt,0) - COALESCE(revenue_amt,0) AS discount_amt,

  (COALESCE(revenue_amt,0) + COALESCE(platform_service_fee_amt,0)) - COALESCE(revenue_incl_service_fee_amt,0)
    AS service_fee_adjust_amt,

  -- Channel revenue sum & residual (useful QA)
  (
    COALESCE(wechat_pay_revenue_amt,0) + COALESCE(alipay_pay_revenue_amt,0) + COALESCE(cash_pay_revenue_amt,0)
    + COALESCE(meituan_delivery_revenue_amt,0) + COALESCE(taobao_shangou_revenue_amt,0) + COALESCE(jd_miaosong_revenue_amt,0)
    + COALESCE(meituan_coupon_revenue_amt,0) + COALESCE(douyin_coupon_revenue_amt,0) + COALESCE(alipay_coupon_revenue_amt,0)
    + COALESCE(meituan_online_revenue_amt,0) + COALESCE(douyin_online_revenue_amt,0)
  ) AS channel_revenue_sum_amt,

  COALESCE(revenue_amt,0) - (
    COALESCE(wechat_pay_revenue_amt,0) + COALESCE(alipay_pay_revenue_amt,0) + COALESCE(cash_pay_revenue_amt,0)
    + COALESCE(meituan_delivery_revenue_amt,0) + COALESCE(taobao_shangou_revenue_amt,0) + COALESCE(jd_miaosong_revenue_amt,0)
    + COALESCE(meituan_coupon_revenue_amt,0) + COALESCE(douyin_coupon_revenue_amt,0) + COALESCE(alipay_coupon_revenue_amt,0)
    + COALESCE(meituan_online_revenue_amt,0) + COALESCE(douyin_online_revenue_amt,0)
  ) AS other_revenue_residual_amt,

  -- Raw channel fields (for dashboard breakdown)
  wechat_pay_gross_amt, wechat_pay_revenue_amt, wechat_pay_cnt,
  alipay_pay_gross_amt, alipay_pay_revenue_amt, alipay_pay_cnt,
  cash_pay_gross_amt, cash_pay_revenue_amt, cash_pay_cnt,
  meituan_delivery_gross_amt, meituan_delivery_revenue_amt, meituan_delivery_cnt,
  taobao_shangou_gross_amt, taobao_shangou_revenue_amt, taobao_shangou_cnt,
  jd_miaosong_gross_amt, jd_miaosong_revenue_amt, jd_miaosong_cnt,
  meituan_coupon_gross_amt, meituan_coupon_revenue_amt, meituan_coupon_cnt,
  douyin_coupon_gross_amt, douyin_coupon_revenue_amt, douyin_coupon_cnt,
  alipay_coupon_gross_amt, alipay_coupon_revenue_amt, alipay_coupon_cnt,
  meituan_online_gross_amt, meituan_online_revenue_amt, meituan_online_discount_amt,
  douyin_online_gross_amt, douyin_online_revenue_amt, douyin_online_cnt

FROM bonjur_ods.sales_daily_self_service;

-- Tall table: daily breakdown (gross + revenue)
DROP VIEW IF EXISTS bonjur_dm.v_sales_daily_channel_breakdown_v1 CASCADE;

CREATE VIEW bonjur_dm.v_sales_daily_channel_breakdown_v1 AS
-- Wechat (total + subchannels)
SELECT store_code, store_name, biz_date, month,
       'wechat' AS channel_code, '微信支付' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       wechat_pay_gross_amt AS gross_sales_amt, wechat_pay_revenue_amt AS revenue_amt, wechat_pay_cnt AS txn_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'wechat_miniapp' AS channel_code, '微信支付-小程序渠道' AS channel_name,
       'wechat' AS parent_channel_code, 1::int AS channel_level,
       wechat_pay_miniapp_gross_amt, wechat_pay_miniapp_revenue_amt, NULL::int AS txn_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'wechat_pos' AS channel_code, '微信支付-企迈数店POS' AS channel_name,
       'wechat' AS parent_channel_code, 1::int AS channel_level,
       wechat_pay_pos_gross_amt, wechat_pay_pos_revenue_amt, NULL::int AS txn_cnt
FROM bonjur_ods.sales_daily_self_service

-- Alipay (total + subchannels)
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'alipay' AS channel_code, '支付宝支付' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       alipay_pay_gross_amt, alipay_pay_revenue_amt, alipay_pay_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'alipay_miniapp' AS channel_code, '支付宝支付-小程序渠道' AS channel_name,
       'alipay' AS parent_channel_code, 1::int AS channel_level,
       alipay_pay_miniapp_gross_amt, alipay_pay_miniapp_revenue_amt, NULL::int AS txn_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'alipay_pos' AS channel_code, '支付宝支付-企迈数店POS' AS channel_name,
       'alipay' AS parent_channel_code, 1::int AS channel_level,
       alipay_pay_pos_gross_amt, alipay_pay_pos_revenue_amt, NULL::int AS txn_cnt
FROM bonjur_ods.sales_daily_self_service

-- Cash
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'cash' AS channel_code, '现金' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       cash_pay_gross_amt, cash_pay_revenue_amt, cash_pay_cnt
FROM bonjur_ods.sales_daily_self_service

-- Delivery / instant retail
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'meituan_delivery' AS channel_code, '美团外卖' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       meituan_delivery_gross_amt, meituan_delivery_revenue_amt, meituan_delivery_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'taobao_shangou' AS channel_code, '淘宝闪购' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       taobao_shangou_gross_amt, taobao_shangou_revenue_amt, taobao_shangou_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'jd_miaosong' AS channel_code, '京东秒送' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       jd_miaosong_gross_amt, jd_miaosong_revenue_amt, jd_miaosong_cnt
FROM bonjur_ods.sales_daily_self_service

-- Coupons
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'meituan_coupon' AS channel_code, '美团团购券' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       meituan_coupon_gross_amt, meituan_coupon_revenue_amt, meituan_coupon_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'douyin_coupon' AS channel_code, '抖音团购券' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       douyin_coupon_gross_amt, douyin_coupon_revenue_amt, douyin_coupon_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'alipay_coupon' AS channel_code, '支付宝团购券' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       alipay_coupon_gross_amt, alipay_coupon_revenue_amt, alipay_coupon_cnt
FROM bonjur_ods.sales_daily_self_service

-- Online order
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'meituan_online' AS channel_code, '美团在线点' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       meituan_online_gross_amt, meituan_online_revenue_amt, NULL::int AS txn_cnt
FROM bonjur_ods.sales_daily_self_service
UNION ALL
SELECT store_code, store_name, biz_date, month,
       'douyin_online' AS channel_code, '抖音在线点' AS channel_name,
       NULL::text AS parent_channel_code, 0::int AS channel_level,
       douyin_online_gross_amt, douyin_online_revenue_amt, douyin_online_cnt
FROM bonjur_ods.sales_daily_self_service;

-- Monthly rollup (for dashboard)
DROP VIEW IF EXISTS bonjur_dm.sales_monthly_report_v1 CASCADE;

CREATE VIEW bonjur_dm.sales_monthly_report_v1 AS
SELECT
  store_code,
  store_name,
  month,
  SUM(COALESCE(gross_sales_amt,0)) AS gross_sales_amt,
  SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
  SUM(COALESCE(order_cnt,0)) AS order_cnt,
  SUM(COALESCE(refund_amt,0)) AS refund_amt,
  SUM(COALESCE(revenue_incl_service_fee_amt,0)) AS revenue_incl_service_fee_amt,
  SUM(COALESCE(platform_service_fee_amt,0)) AS platform_service_fee_amt,
  CASE WHEN SUM(COALESCE(gross_sales_amt,0)) > 0
    THEN ROUND(SUM(COALESCE(revenue_amt,0)) / SUM(gross_sales_amt), 6)
    ELSE NULL
  END AS cash_in_rate,
  CASE WHEN SUM(COALESCE(gross_sales_amt,0)) > 0
    THEN ROUND(100.0 * SUM(COALESCE(revenue_amt,0)) / SUM(gross_sales_amt), 2)
    ELSE NULL
  END AS cash_in_rate_pct,
  SUM(COALESCE(gross_sales_amt,0) - COALESCE(revenue_amt,0)) AS discount_amt
FROM bonjur_ods.sales_daily_self_service
GROUP BY store_code, store_name, month
ORDER BY month DESC;

DROP VIEW IF EXISTS bonjur_dm.v_sales_monthly_channel_breakdown_v1 CASCADE;

CREATE VIEW bonjur_dm.v_sales_monthly_channel_breakdown_v1 AS
SELECT
  store_code,
  store_name,
  month,
  channel_code,
  channel_name,
  parent_channel_code,
  channel_level,
  SUM(COALESCE(gross_sales_amt,0)) AS gross_sales_amt,
  SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
  SUM(COALESCE(txn_cnt,0)) AS txn_cnt
FROM bonjur_dm.v_sales_daily_channel_breakdown_v1
GROUP BY store_code, store_name, month, channel_code, channel_name, parent_channel_code, channel_level
ORDER BY month DESC, revenue_amt DESC;
