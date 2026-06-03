# 销售分析页 — 数据来源清单

---

## API 调用

sales 页面调用品牌特有 API:
- `GET /api/{gelatomiiix|bonjur}/sales/overview`
- `GET /api/{gelatomiiix|bonjur}/sales/products`
- `GET /api/{gelatomiiix|bonjur}/sales/channels`
- `GET /api/{gelatomiiix|bonjur}/sales/trend`
- `GET /api/{gelatomiiix|bonjur}/sales/details`

## 数据来源

> **⚠️ 销售数据不涉及 bank_txn。** 其来源是：
> - `income_detail` (Qimai 订单数据)
> - `product_sales_detail` (商品销售明细 — 来自收银系统)
> 
> 与银行流水分类无关，因此不适用 bank_txn_classified_snapshot 规范。

## 关键字段

| 字段 | 来源表 | 说明 |
|---|---|---|
| net_amt | income_detail | 企迈订单净额 |
| sales_amt / qty | product_sales_detail | 收银系统数据 |
| payment_methods | income_detail | 支付方式数组 |
