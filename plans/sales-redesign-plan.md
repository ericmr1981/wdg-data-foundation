# /u/sales 重构 — Implementation Plan

## 执行顺序: 三轮串行

```
Round 1: gelatomiiix (先验证模式)
Round 2: bonjur (相同模式微调)
Round 3: 清理 + 入口重写
```

---

## Round 1 — gelatomiiix (蜜可诗)

### T1.1 创建 DM 视图 SQL

**File: `sql/30_gelatomiiix_dm_v_sales_overview.sql`**
- 源表: `gelatomiiix_ods.income_detail` (WHERE NOT is_refund)
- 输出: store_code, month, gross_amt, revenue_amt, discount_amt, net_amt, order_cnt, cash_in_rate, discount_rate, avg_order_amt, + LAG 环比
- 参照: `30_tamkoko_dm_v_cash_register_overview.sql`

**File: `sql/30_gelatomiiix_dm_v_sales_daily.sql`**
- 源表: `gelatomiiix_ods.income_detail`
- 输出: store_code, biz_date, gross_amt, revenue_amt, discount_amt, net_amt, order_cnt, cash_in_rate
- Group by store_code, biz_date

**File: `sql/30_gelatomiiix_dm_v_sales_channel.sql`**
- 源表: `gelatomiiix_ods.income_detail` + `unnest(payment_methods)`
- 输出: store_code, month, channel(payment_method), gross_amt, revenue_amt, order_cnt, cash_in_rate
- payment_methods 为 NULL 的行也保留(标记为'其他')

**File: `sql/30_gelatomiiix_dm_v_sales_dine_takeaway.sql`**
- 源表: `gelatomiiix_ods.income_detail`
- 输出: store_code, month, order_type(堂食/打包), gross_amt, revenue_amt, order_cnt

**File: `sql/30_gelatomiiix_dm_v_sales_trend.sql`**
- 直接从 v_sales_overview 读最近12个月

**File: `sql/30_gelatomiiix_dm_v_sales_product.sql`**
- 源表: `gelatomiiix_ods.product_sales_detail`
- 输出: store_code, month, product_name, total_qty, total_sales, total_received

### T1.2 创建 API Routes

所有 API 读 DM 视图，模式一致:

**File: `ui/src/app/api/gelatomiiix/sales/overview/route.ts`**
- 重写，从 `brand_gelatomiiix_dm.v_sales_overview` 读
- 参数: store_code, month

**File: `ui/src/app/api/gelatomiiix/sales/daily/route.ts`** (新建)
- 从 `brand_gelatomiiix_dm.v_sales_daily` 读

**File: `ui/src/app/api/gelatomiiix/sales/channel/route.ts`**
- 重写，从 `brand_gelatomiiix_dm.v_sales_channel` 读

**File: `ui/src/app/api/gelatomiiix/sales/dine-takeaway/route.ts`** (新建)
- 从 `brand_gelatomiiix_dm.v_sales_dine_takeaway` 读

**File: `ui/src/app/api/gelatomiiix/sales/trend/route.ts`**
- 重写，从 `brand_gelatomiiix_dm.v_sales_trend` 读

**File: `ui/src/app/api/gelatomiiix/sales/product/route.ts`** (新建)
- 从 `brand_gelatomiiix_dm.v_sales_product` 读

### T1.3 创建 UI 页面

**File: `ui/src/app/u/sales/gelatomiiix/page.tsx`** (新建)
- 参照 `tamkoko/page.tsx` 结构，适配 gelatomiiix 数据字段
- 页面元素: 5 KPI 卡片 → 12 月趋势(ComposedChart + 日级 drill-down) → 渠道分布(PieChart + 表) → 堂食vs外卖(PieChart + 表) → 商品Top10(BarChart×2) → 渠道趋势(LineChart)
- 复用 tamkoko 的 Section/Empty 组件

### T1.4 验证

- `docker exec wdg-systemd psql -U postgres -d dataplatform -f sql/30_gelatomiiix_dm_v_sales_*.sql` — 视图创建
- curl 验证每个 API 返回 200 + data
- `cd ui && npx tsc --noEmit` — TypeScript 编译通过

---

## Round 2 — bonjur (旺鼎阁)

### T2.1 创建 DM 视图 SQL

与 gelatomiiix 同模式，差异点:
- 源表: `bonjur_ods.income_detail`
- 无 discount_amt → 视图去掉 discount 相关列
- channel 视图: 用 `order_source` 字段(文本)，不是 unnest(payment_methods)

**Files (6个):**
`sql/30_bonjur_dm_v_sales_overview.sql`
`sql/30_bonjur_dm_v_sales_daily.sql`
`sql/30_bonjur_dm_v_sales_channel.sql`
`sql/30_bonjur_dm_v_sales_dine_takeaway.sql`
`sql/30_bonjur_dm_v_sales_trend.sql`
`sql/30_bonjur_dm_v_sales_product.sql`

### T2.2 创建 API Routes

**Files (6个):**
`ui/src/app/api/bonjur/sales/overview/route.ts` (重写, 读 bonjur_dm.v_sales_overview)
`ui/src/app/api/bonjur/sales/daily/route.ts` (新建)
`ui/src/app/api/bonjur/sales/channel/route.ts` (重写)
`ui/src/app/api/bonjur/sales/dine-takeaway/route.ts` (新建)
`ui/src/app/api/bonjur/sales/trend/route.ts` (重写)
`ui/src/app/api/bonjur/sales/product/route.ts` (新建)

### T2.3 创建 UI 页面

**File: `ui/src/app/u/sales/bonjur/page.tsx`** (新建)
- 参照 gelatomiiix/page.tsx，微调字段名(无 discount 卡片)
- Bonjur 订单类型: 外卖/堂食/打包 (三饼图而非两饼)

### T2.4 验证

- 视图 apply + API curl + tsc 编译

---

## Round 3 — 清理 + 入口重写

### T3.1 删除旧页面

```
删除: ui/src/app/u/sales/page.tsx           (旧的糅合页)
删除: ui/src/app/u/sales/details/page.tsx    (旧的明细页)
```

### T3.2 重写入口

**File: `ui/src/app/u/sales/page.tsx`** (新建)
- 纯客户端组件，根据 `useBrand().brand` redirect:
  - gelatomiiix → `/u/sales/gelatomiiix`
  - bonjur → `/u/sales/bonjur`
  - tamkoko → `/u/sales/tamkoko`

### T3.3 删除旧 API

```
删除以下旧 API routes (被新 API 替代):
  ui/src/app/api/gelatomiiix/sales/details/route.ts
  ui/src/app/api/gelatomiiix/sales/distribution/route.ts
  ui/src/app/api/gelatomiiix/sales/hourly/route.ts
  ui/src/app/api/gelatomiiix/sales/products/route.ts   (被 product/route.ts 替代)
  ui/src/app/api/bonjur/sales/details/route.ts
  ui/src/app/api/bonjur/sales/products/route.ts
  ui/src/app/api/bonjur/sales/qimai-pos/route.ts
  ui/src/app/api/bonjur/sales/upload-product/route.ts
  ui/src/app/api/bonjur/sales/upload-self-service/route.ts
```

### T3.4 最终验证

- `cd ui && npx tsc --noEmit` — 通过
- 访问 `localhost:3001/u/sales` → 自动跳转到品牌子页面
- 三个品牌页面都能正常加载

---

## 文件统计

| Round | SQL | API Route | UI Page | 删除 |
|-------|-----|-----------|---------|------|
| R1 (gelatomiiix) | 6 | 6 | 1 | 0 |
| R2 (bonjur) | 6 | 6 | 1 | 0 |
| R3 (清理) | 0 | 0 | 1(入口) | 11 |
| **合计** | **12** | **12** | **3** | **11** |
