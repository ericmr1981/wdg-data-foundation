-- Bonjur｜营业数据（自助下载明细）ODS DDL（日粒度）
-- Source: 自助下载报表 CSV（含多渠道营业额/营业收入拆分）

create schema if not exists bonjur_ods;

create table if not exists bonjur_ods.sales_daily_self_service (
  id bigserial primary key,

  store_code text not null,
  store_name text,

  biz_date date not null,
  month date not null, -- YYYY-MM-01

  -- top-level
  gross_sales_amt numeric(14,2),                     -- 营业额
  revenue_amt numeric(14,2),                         -- 营业收入
  order_cnt int,                                     -- 有效订单数
  refund_amt numeric(14,2),                          -- 退款金额
  revenue_incl_service_fee_amt numeric(14,2),        -- 营业收入（含服务费）
  platform_service_fee_amt numeric(14,2),            -- 平台服务费

  -- 微信支付
  wechat_pay_gross_amt numeric(14,2),
  wechat_pay_revenue_amt numeric(14,2),
  wechat_pay_cnt int,
  wechat_pay_miniapp_gross_amt numeric(14,2),
  wechat_pay_miniapp_revenue_amt numeric(14,2),
  wechat_pay_pos_gross_amt numeric(14,2),
  wechat_pay_pos_revenue_amt numeric(14,2),

  -- 支付宝支付
  alipay_pay_gross_amt numeric(14,2),
  alipay_pay_revenue_amt numeric(14,2),
  alipay_pay_cnt int,
  alipay_pay_miniapp_gross_amt numeric(14,2),
  alipay_pay_miniapp_revenue_amt numeric(14,2),
  alipay_pay_pos_gross_amt numeric(14,2),
  alipay_pay_pos_revenue_amt numeric(14,2),

  -- 现金
  cash_pay_gross_amt numeric(14,2),
  cash_pay_revenue_amt numeric(14,2),
  cash_pay_cnt int,

  -- 外卖/闪购/秒送
  meituan_delivery_gross_amt numeric(14,2),
  meituan_delivery_revenue_amt numeric(14,2),
  meituan_delivery_cnt int,

  taobao_shangou_gross_amt numeric(14,2),
  taobao_shangou_revenue_amt numeric(14,2),
  taobao_shangou_cnt int,

  jd_miaosong_gross_amt numeric(14,2),
  jd_miaosong_revenue_amt numeric(14,2),
  jd_miaosong_cnt int,

  -- 团购券
  meituan_coupon_cnt int,
  meituan_coupon_gross_amt numeric(14,2),
  meituan_coupon_revenue_amt numeric(14,2),

  douyin_coupon_cnt int,
  douyin_coupon_gross_amt numeric(14,2),
  douyin_coupon_revenue_amt numeric(14,2),

  alipay_coupon_cnt int,
  alipay_coupon_gross_amt numeric(14,2),
  alipay_coupon_revenue_amt numeric(14,2),

  -- 在线点
  meituan_online_gross_amt numeric(14,2),
  meituan_online_revenue_amt numeric(14,2),
  meituan_online_discount_amt numeric(14,2),

  douyin_online_cnt int,
  douyin_online_gross_amt numeric(14,2),
  douyin_online_revenue_amt numeric(14,2),

  source_file_id bigint,
  created_at timestamptz not null default now(),

  constraint uq_bonjur_sales_daily_self_service unique (store_code, biz_date)
);

create index if not exists idx_bonjur_sales_daily_self_service_month on bonjur_ods.sales_daily_self_service(month);
create index if not exists idx_bonjur_sales_daily_self_service_store_month on bonjur_ods.sales_daily_self_service(store_code, month);
create index if not exists idx_bonjur_sales_daily_self_service_date on bonjur_ods.sales_daily_self_service(biz_date);
