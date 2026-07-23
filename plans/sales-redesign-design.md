# /u/sales 重构 — Design Document

## 问题

当前 `/u/sales` 架构混乱：gelatomiiix 和 bonjur 糅合在一个 `page.tsx` 里用 if/else 分叉，没有 DM 视图层、API 里嵌裸 SQL。tamkoko 已经有一套完整的三层架构（DM views → API → UI）。三品牌体验不统一。

## 方案

**参考 tamkoko 的三层架构，为 gelatomiiix 和 bonjur 各建独立页面。**

### 架构对齐

```
gelatomiiix: income_detail → DM views → API routes → gelatomiiix/page.tsx
bonjur:      income_detail → DM views → API routes → bonjur/page.tsx
tamkoko:    cash_register_order → DM views → API routes → tamkoko/page.tsx  (已有)
```

### 每个品牌 6 个 DM 视图（统一命名）

| 视图 | 数据源 | 维度 | gelatomiiix | bonjur |
|------|--------|------|-------------|--------|
| `v_sales_overview` | income_detail | store × month, LAG环比 | ✅ | ✅ (无discount) |
| `v_sales_daily` | income_detail | store × biz_date | ✅ | ✅ |
| `v_sales_trend` | v_sales_overview | 12-month | ✅ | ✅ |
| `v_sales_channel` | income_detail | store × month × source | payment_methods(unnest) | order_source |
| `v_sales_dine_takeaway` | income_detail | store × month × order_type | ✅ | ✅ |
| `v_sales_product` | product_sales_detail | store × month × product | ✅ | ✅ |

### 每个品牌 6 个 API（统一路径）

```
GET /api/{brand}/sales/overview?store=&month=     → v_sales_overview
GET /api/{brand}/sales/daily?store=&month=         → v_sales_daily
GET /api/{brand}/sales/trend?store=&months=12      → v_sales_trend
GET /api/{brand}/sales/channel?store=&month=       → v_sales_channel
GET /api/{brand}/sales/dine-takeaway?store=&month= → v_sales_dine_takeaway
GET /api/{brand}/sales/product?store=&month=       → v_sales_product
```

全部从 DM 视图读，每个 route 约 30 行，跟 tamkoko 同款模式。

### UI 页面布局（统一）

每个品牌页面共用：5 KPI 卡片 + 趋势图组（点击钻取日级） + 渠道分布(donut+表) + 堂食外卖 + 商品Top10 + 渠道趋势。组件的图表组件（GroupedBarChart/MultiStoreTrendChart 等）直接复用 tamkoko。

### 品牌差异

- **gelatomiiix**: 1 门店(sh_xtd)，渠道用 payment_methods(展开数组)，order_type=堂食/打包（没有外卖）
- **bonjur**: 1 门店(wz_wxc)，渠道用 order_source(文本)，order_type=外卖/堂食/打包，没有 discount 和 qty
- **bonjur 没有 discount_amt**: overview 视图去掉 discount 相关列

## 执行策略

**按品牌串行推进**：先 gelatomiiix（数据最简单，验证模式）→ 再 bonjur（相同模式微调）→ 最后删除旧代码 + 入口重写。

## 不做什么

- 不给 bonjur 做 meal_period（数据源无此字段）
- 不创建 gelatomiiix/bonjur 的上传页（已有旧的上传 API，暂不纳入本次范围）
- 不动 tamkoko 页面
- 不引入新依赖

## 验收标准

- `tsc --noEmit` 通过
- 三个品牌 /u/sales 页面风格统一
- API 全部从 DM 视图读（不直接查 ODS）
- gelatomiiix 页面能正常加载 KPI/趋势/渠道/堂食外卖/商品
- bonjur 页面同
