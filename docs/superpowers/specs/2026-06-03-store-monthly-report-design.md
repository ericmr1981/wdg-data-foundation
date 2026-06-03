# 门店月报模块设计

## 1. 概述

在现有 Next.js UI 中新增"门店月报"功能模块。基于已分类的银行流水与现有 3 张财务视图（`v_profit_statement` / `v_cashflow_statement` / `v_balance_sheet`），按门店 × 月份聚合 9 个核心财务指标，提供当月快照、12 个月历史趋势、Excel 下载能力。

支撑品牌：`gelatomiiix`（`brand_gelatomiiix_dm`）、`bonjur`（`bonjur_dm`）、`xintiandi`（通过 `brand_tamkoko_dm`）。

## 2. 范围

### 包含
- 新建专用视图 `{brand}_dm.v_store_monthly_kpi`：一行 = 一月 × 一门店，9 个指标
- 3 个 API 端点：snapshot（当月+上月）、trend（12月）、export（Excel）
- `/u/store-report` 页面：筛选 + KPI 卡片 + 趋势图 + 下载
- Excel 多 Sheet 导出（4 个 Sheet）
- 顶栏新增一级菜单「报表」
- dashboard 快捷入口补一张卡

### 不包含
- 销售类指标（营业额、订单数等）—— 销售数据走 `/u/sales`，本模块仅财务
- PDF 导出
- 邮件/定时推送
- 跨品牌合并报表
- 自定义指标配置
- 期初/期末对比（仅当月 vs 上月环比）

## 3. 指标定义

9 个核心指标，全部基于 `v_store_monthly_kpi` 视图：

| # | 字段 | 来源 | 公式 |
|---|---|---|---|
| 1 | `revenue_amt` | v_profit_statement | `SUM(amount WHERE section='revenue')` |
| 2 | `cost_amt` | v_profit_statement | `SUM(amount WHERE section='cost')` |
| 3 | `expense_amt` | v_profit_statement | `SUM(amount WHERE section='expense')` |
| 4 | `gross_profit_amt` | 派生 | `revenue_amt - cost_amt` |
| 5 | `net_profit_amt` | 派生 | `revenue_amt - cost_amt - expense_amt` |
| 6 | `operating_cf_amt` | v_cashflow_statement | `SUM(net_amount WHERE activity='operating')` |
| 7 | `cash_balance` | v_balance_sheet | 直读 |
| 8 | `cashflow_runway_months` | 派生 | `cash_balance / |operating_cf_amt|`，仅 `operating_cf_amt < 0` 时非 NULL |
| 9 | `hr_amt` | v_profit_statement | `SUM(amount WHERE section='expense' AND lvl1_code='HR')` |
| 10 | `rent_amt` | v_profit_statement | `SUM(amount WHERE section='expense' AND lvl1_code='RENT_UTIL')` |
| 11 | `hr_ratio_pct` | 派生 | `hr_amt / NULLIF(revenue_amt, 0) * 100`，保留 1 位 |
| 12 | `rent_ratio_pct` | 派生 | `rent_amt / NULLIF(revenue_amt, 0) * 100`，保留 1 位 |

**口径约定**：
- 所有金额单位：元（数据库 numeric，前端按需格式化）
- 收入/支出符号：流入为正、流出为负
- `hr_amt` / `rent_amt` 是绝对值；UI 卡片显示 `hr_ratio_pct` / `rent_ratio_pct`（比率更有运营参考价值）
- 与 `/u/financial` 完全同口径（同 view 同 section 划分）

## 4. 数据架构

### 4.1 新建视图

每个有数据的 brand schema 下各建一份：

```sql
-- sql/40_store_monthly_kpi_view.sql
-- 在 bonjur_dm / brand_gelatomiiix_dm / brand_tamkoko_dm 下分别执行

CREATE OR REPLACE VIEW v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month,
    store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END)                                          AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END)                                          AS cost_amt,
    SUM(CASE WHEN section = 'expense'  THEN amount ELSE 0 END)                                          AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END)              AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END)              AS rent_amt
  FROM v_profit_statement
  GROUP BY month, store_code
),
cashflow_agg AS (
  SELECT
    month,
    store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END)                                   AS operating_cf_amt,
    SUM(total_in)                                                                                      AS total_in_amt,
    SUM(total_out)                                                                                     AS total_out_amt
  FROM v_cashflow_statement
  GROUP BY month, store_code
)
SELECT
  p.month,
  p.store_code,
  p.revenue_amt,
  p.cost_amt,
  p.expense_amt,
  p.hr_amt,
  p.rent_amt,
  p.revenue_amt - p.cost_amt                                                     AS gross_profit_amt,
  p.revenue_amt - p.cost_amt - p.expense_amt                                     AS net_profit_amt,
  c.operating_cf_amt,
  c.total_in_amt,
  c.total_out_amt,
  b.cash_balance,
  b.loan_balance,
  CASE
    WHEN c.operating_cf_amt < 0
      THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(p.hr_amt::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1)                  AS hr_ratio_pct,
  ROUND(p.rent_amt::numeric / NULLIF(p.revenue_amt, 0) * 100, 1)                  AS rent_ratio_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN v_balance_sheet b USING (month, store_code);
```

**注意事项**：
- `lvl1_code` 字典值在 `sql/10_yufeng_category_dictionary.sql` 维护，需确认所有 brand schema 一致
- `gelatomiiix_dm` 为空 schema，不建视图
- 视图是只读聚合，不修改源数据

### 4.2 新建 DDL 文件

| 文件 | 操作 |
|---|---|
| `sql/40_store_monthly_kpi_view.sql` | 新增，幂等（CREATE OR REPLACE），包含 3 个 schema 的视图创建 |

## 5. API 端点

### 5.1 `GET /api/store-report/snapshot`

**参数**（query string）：
- `brand`: 必填，枚举 `gelatomiiix | bonjur | xintiandi`
- `store`: 必填，门店代码（如 `wenzhou_wxc`）
- `month`: 必填，`YYYY-MM` 格式

**响应**：
```ts
{
  success: true,
  data: {
    current:  {
      month: '2026-06',
      revenue_amt: 856000, cost_amt: 404000, expense_amt: 482000,
      gross_profit_amt: 452000, net_profit_amt: -30000,
      operating_cf_amt: -31000, cash_balance: 3556,
      cashflow_runway_months: 0.1,
      hr_amt: 200000, rent_amt: 80000,
      hr_ratio_pct: 23.4, rent_ratio_pct: 9.3
    },
    previous: { month: '2026-05', /* 同结构 */ }
  }
}
```

**错误处理**：
- 401: 未登录
- 400: 缺参数 / 月份格式错
- 404: 该 store 在该 brand schema 下无数据
- 视图未就绪（42P01）: `{ success: true, data: null, note: 'view not ready' }`

### 5.2 `GET /api/store-report/trend`

**参数**：
- `brand`: 必填
- `store`: 必填
- `months`: 可选，默认 12，最大 24

**响应**：
```ts
{
  success: true,
  data: {
    months: ['2025-07', ..., '2026-06'],
    series: {
      revenue_amt:        [/* 12 个数 */],
      cost_amt:           [...],
      // ... 所有 9 个指标
    }
  }
}
```

**实现**：调用 `v_store_monthly_kpi` 拉该 (brand, store) 最近 N 月。

### 5.3 `GET /api/store-report/export`

**参数**：同 snapshot
**响应**：`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，文件名 `{brand}_{store}_{month}.xlsx`

**Excel 结构**（4 个 Sheet）：

| Sheet | 内容 | 行 × 列 |
|---|---|---|
| 门店信息 | 品牌、门店、月份、生成时间戳 | 1 × 4 |
| 当月快照 | 12 个指标 × 4 列（指标名 / 当月值 / 上月值 / 环比%） | 12 × 4 |
| 历史趋势 | 12 行（月份）× 12 列（指标） | 12 × 13 |
| 同期对比 | 当月 vs 去年同期（如有数据则 12 个指标 × 4 列） | 12 × 4 |

**实现**：服务端用 `xlsx` (SheetJS) 库 in-memory 生成 → 返回 Buffer。

## 6. UI 布局

**路径**：`/u/store-report`

```
┌──────────────────────────────────────────────────────────────┐
│ 门店月报                                          [⬇ 下载]   │
├──────────────────────────────────────────────────────────────┤
│ 品牌 [Bonjur ▼]   门店 [温州万象城 ▼]   月份 [2026-06 ▼]    │
├──────────────────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│ │营业收入│ │营业支出│ │毛  利  │ │净利润  │ │经营现金│       │
│ │¥85.6万 │ │¥48万   │ │52.8%   │ │-3.5%   │ │流-3.1万│       │
│ │↓24.5%  │ │↑...    │ │↓7.6%   │ │↓4.5%   │ │↑70%   │       │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                  │
│ │银行余额│ │现金流  │ │人力占  │ │租金占  │                  │
│ │¥3,556  │ │月数0.1 │ │比率23% │ │比率9%  │                  │
│ │...     │ │...     │ │↓1.2%   │ │↑0.3%   │                  │
│ └────────┘ └────────┘ └────────┘ └────────┘                  │
├──────────────────────────────────────────────────────────────┤
│ ┌────────────────────┐ ┌────────────────────┐               │
│ │ 营业收入趋势 (12月) │ │ 营业支出趋势 (12月) │               │
│ │ [LineChart]        │ │ [LineChart]        │               │
│ └────────────────────┘ └────────────────────┘               │
│ ┌────────────────────┐ ┌────────────────────┐               │
│ │ 毛利 / 净利润趋势   │ │ 经营现金流趋势      │               │
│ │ [LineChart 双线]    │ │ [LineChart]        │               │
│ └────────────────────┘ └────────────────────┘               │
│ ┌────────────────────┐ ┌────────────────────┐               │
│ │ 银行余额趋势        │ │ 现金流月数趋势      │               │
│ │ [LineChart]        │ │ [LineChart]        │               │
│ └────────────────────┘ └────────────────────┘               │
│ ┌────────────────────┐ ┌────────────────────┐               │
│ │ 人力占比率趋势      │ │ 租金占比率趋势      │               │
│ │ [LineChart]        │ │ [LineChart]        │               │
│ └────────────────────┘ └────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

**交互逻辑**：
- 页面初始化：默认品牌 = 第一个有数据的 brand，默认门店 = 该 brand 第一个门店，默认月份 = 当前月
- 切换品牌 → 门店列表重置
- 切换门店 → 重新拉 snapshot + trend
- 切换月份 → 仅重新拉 snapshot（trend 始终相对"现在"的 12 月，不受 month 影响）
- 点击下载 → 调 export API，浏览器原生下载
- 数据加载时显示 skeleton，错误时显示 toast/alert

**环比显示**：KPI 卡片下方显示 `current vs previous` 的百分比变化，箭头 ↑/↓ 加颜色（绿/红）。

## 7. 文件变更清单

### 新增
- `sql/40_store_monthly_kpi_view.sql` — 视图 DDL（3 个 schema）
- `ui/src/app/api/store-report/snapshot/route.ts` — snapshot API
- `ui/src/app/api/store-report/trend/route.ts` — trend API
- `ui/src/app/api/store-report/export/route.ts` — Excel export API
- `ui/src/app/u/store-report/page.tsx` — 主页面
- `ui/src/app/u/store-report/StoreFilter.tsx` — 筛选条组件
- `ui/src/app/u/store-report/KpiCards.tsx` — 9 张 KPI 卡片
- `ui/src/app/u/store-report/TrendChart.tsx` — 趋势图（recharts LineChart）
- `ui/src/lib/store-report-types.ts` — TypeScript 接口
- `ui/src/lib/store-report-queries.ts` — API client (fetch wrapper)
- `ui/src/lib/excel-export.ts` — 共享 Excel 工具

### 修改
- `ui/package.json` — 新增依赖 `xlsx`
- `ui/src/app/providers.tsx` — 顶栏新增「报表」菜单 + 「门店月报」入口
- `ui/src/app/u/dashboard/page.tsx` — 快捷入口补一张「门店月报」卡

### 依赖安装
```bash
cd ui && npm install xlsx
```

## 8. 风险与边界

| 风险 | 缓解 |
|---|---|
| `lvl1_code` 字典值跨 brand 不一致 | 实施前先 `SELECT DISTINCT lvl1_code FROM v_profit_statement` 验证 |
| 比率分母为 0 (revenue_amt=0) | 用 `NULLIF` 保护，返回 NULL |
| 大门店历史数据查询性能 | view 已在 v_profit_statement 上聚合，趋势查询 12 月 × 1 门店量级小（KB 级） |
| 视图未就绪时页面崩 | API 兜底 `42P01` 异常返回 note，UI 显示「数据准备中」 |
| 用户未登录访问 | 沿用现有 middleware 重定向到 /login |

## 9. 验收标准

1. `python scripts/init_local_env.sh` 跑通后，3 个 brand schema 下都存在 `v_store_monthly_kpi` 视图
2. `pytest tests/ -v` 全绿
3. `cd ui && npx next build` 编译通过
4. UI 验收（用 `preview_admin` 账号）:
   - 访问 `/u/store-report` 不报错
   - 切换品牌/门店/月份筛选均能正常加载
   - 9 张 KPI 卡片数值与 `/u/financial` 利润表/现金流量表/资产负债表对应月数据一致
   - 7 张趋势图能正常渲染
   - 点击「下载」按钮能下载 .xlsx 文件，4 个 Sheet 内容齐全
5. 顶栏「报表」菜单可见，「门店月报」可点击
6. Dashboard 快捷入口新增「门店月报」卡片

## 10. 不在范围

- 销售类指标（与 `/u/sales` 重复）
- PDF 导出（仅 Excel）
- 多门店对比、单指标多门店横向
- 自定义时间跨度（仅固定 12 月）
- 邮件/定时推送
- 移动端适配（仅桌面）
