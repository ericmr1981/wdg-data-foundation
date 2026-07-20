# 财务报表页 — 数据来源清单

---

## API 调用总览

| 页面 | API | 用途 | 数据源 |
|---|---|---|---|
| u/financial | `GET /api/stores` | 门店筛选 | ops.stores |
| u/financial | `GET /api/financial/overview` | KPI概览 | v_profit_statement, v_cashflow_statement, v_balance_sheet |
| u/financial tab | `GET /api/financial/profit` | 利润表 | v_profit_statement |
| u/financial tab | `GET /api/financial/cashflow` | 现金流量表 | v_cashflow_statement |
| u/financial tab | `GET /api/financial/balance-sheet` | 资产负债表 | v_balance_sheet |
| u/payment | `GET /api/financial/payment-metrics` | 付款概览 | v_cashflow_statement (out方向) |
| u/payment | `GET /api/financial/counterparty` | 对方科目 | bank_txn + classified_snapshot |
| u/dashboard | `GET /api/financial/overview` | KPI概览 | 同上 |
| u/dashboard | `GET /api/financial/kpi-trend` | KPI趋势 | bank_txn + classified_snapshot |
| u/dashboard | `GET /api/financial/qimai-revenue` | 入账率对比 | v_profit_statement + income_detail |

---

## API 1: overview — 经营概览KPI

**文件:** [ui/src/app/api/financial/overview/route.ts](ui/src/app/api/financial/overview/route.ts)

- 使用 `v_profit_statement`, `v_cashflow_statement`, `v_balance_sheet` 三个 DM 视图
- 返回: revenue, gross_margin_rate, net_profit_rate, operating_cashflow, cash_balance, revenue_per_store, store_count 等
- ✅ 使用预分类快照 (通过视图间接引用)

## API 2: profit — 利润表

**文件:** [ui/src/app/api/financial/profit/route.ts](ui/src/app/api/financial/profit/route.ts)

- 查询 `v_profit_statement` 视图
- 返回按 month/store 分组的收入/支出各科目及金额
- ✅ 使用预分类快照

## API 3: cashflow — 现金流量表

**文件:** [ui/src/app/api/financial/cashflow/route.ts](ui/src/app/api/financial/cashflow/route.ts)

- 查询 `v_cashflow_statement` 视图
- 按 operating/investing/financing 三类活动分组
- ✅ 使用预分类快照

## API 4: balance-sheet — 资产负债表

**文件:** [ui/src/app/api/financial/balance-sheet/route.ts](ui/src/app/api/financial/balance-sheet/route.ts)

- 查询 `v_balance_sheet` 视图
- 返回: cash_balance, loan_balance, capital_balance, retained_earnings
- ✅ 使用预分类快照

## API 5: payment-metrics — 付款指标

**文件:** [ui/src/app/api/financial/payment-metrics/route.ts](ui/src/app/api/financial/payment-metrics/route.ts)

- 查询 `v_cashflow_statement` 视图 (out方向)
- ✅ 使用预分类快照

## API 6: kpi-trend — KPI趋势

**文件:** [ui/src/app/api/financial/kpi-trend/route.ts](ui/src/app/api/financial/kpi-trend/route.ts)

- 直接 JOIN `bank_txn_classified_snapshot` (非视图)
- ✅ 使用预分类快照，无需规则再次匹配

## API 7: qimai-revenue — 企迈营收对比

**文件:** [ui/src/app/api/financial/qimai-revenue/route.ts](ui/src/app/api/financial/qimai-revenue/route.ts)

- 银行端: 查 `v_profit_statement` (预分类快照 ✅)
- 企迈端: 查 `income_detail` (Qimai平台数据)
- 用于入账率计算

> 5 个 financial API 接受 `period='all'` 作为"全量" sentinel,等同于不限日期范围,返回品牌或门店的全部历史聚合。`income-metrics` / `payment-metrics` 已长期支持;`overview` / `kpi-trend` / `qimai-revenue` 自 2026-07-19 起支持。

---

## 数据血缘

```
bank_txn → fn_classify() → bank_txn_classified_snapshot (BASE TABLE)
  ├── v_cashflow_statement → income-metrics, overview, cashflow, payment-metrics
  ├── v_profit_statement   → profit, overview, qimai-revenue
  └── v_balance_sheet      → balance-sheet, overview
```

所有 financial API ✅ 全部使用预分类快照，无独立模糊匹配。
