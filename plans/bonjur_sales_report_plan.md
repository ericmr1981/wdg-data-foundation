# Bonjur Sales Report (营业数据报表) — Plan

## Goals
- Add sales daily data reporting for **Bonjur** brand (store: 温州万象城 as sample).
- Add KPI: **实收率 = 营业收入 / 营业额**
- Dashboard: add breakdowns for **营业额** and **营业收入** by payment/channel.

## Confirmed field relationships (from sample CSV)
- 折前单均价 = 营业额 / 有效订单数 (rounded)
- 折后单均价 = 营业收入 / 有效订单数 (rounded)
- 微信/支付宝总计 = 子渠道求和 (严格相等)
- 营业收入 ≈ 各渠道营业收入之和（存在 residual，需显式暴露）
- 营业收入（含服务费）与平台服务费不应强推（存在 adjustment）

## Proposed DM metrics
- gross_amt = 营业额
- net_revenue_amt = 营业收入
- cash_in_rate = 实收率 = net_revenue_amt / gross_amt
- discount_amt = gross_amt - net_revenue_amt
- service_fee_amt = 平台服务费
- revenue_incl_service_fee_amt = 营业收入（含服务费）
- service_fee_adjust_amt = (net_revenue_amt + service_fee_amt) - revenue_incl_service_fee_amt
- channel_revenue_sum_amt = sum(channel revenue columns)
- other_revenue_residual_amt = net_revenue_amt - channel_revenue_sum_amt

## Dashboard breakdowns
Break down both gross_amt and net_revenue_amt by these channel groups (as fine-grained as available):
- 微信支付（总）
  - 微信支付-小程序渠道
  - 微信支付-企迈数店POS
- 支付宝支付（总）
  - 支付宝支付-小程序渠道
  - 支付宝支付-企迈数店POS
- 现金
- 美团外卖
- 淘宝闪购
- 京东秒送
- 团购券：美团/抖音/支付宝
- 在线点：美团/抖音

Notes:
- Breakdown sum may be < gross_amt (expected) because gross includes discounts/other items.
- Breakdown sum should be ~= net_revenue_amt with residual exposed.
