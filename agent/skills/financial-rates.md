---
name: financial-rates
description: |
  财务数据口径. 任何涉及毛利率/净利率/财务三表的查询加载.
  解释收付实现制 + 各种 rate 字段的单位约定.
triggers:
  - "毛利率"
  - "净利率"
  - "财务三表"
  - "现金流量"
  - "资产负债表"
---

# Financial Query Conventions

## 会计基础

本平台使用 **收付实现制 (cash-basis)**. `v_profit_statement` 存的是:
- 收入为正数
- 费用为负数

绝大多数 API 把费用 ABS-sum 成正的 `expenses` 字段; `/api/financial/profit` 返回带符号的 line item.

## 比率字段的两种单位约定

| 字段名格式 | 例子 | 单位 | 显示 |
|---|---|---|---|
| camelCase + `Rate` | `grossMarginRate`, `netProfitRate` (来自 `query_financial_overview`) | **小数** | 0.42 → 42% |
| snake_case + `_rate` | `gross_margin_rate`, `net_profit_rate` (在 `query_financial_kpi_trend.monthly[]` 里) | **小数** | 0.42 → 42% |
| snake_case + `_rate_pct` | `gross_profit_rate_pct`, `net_profit_rate_pct` (来自 `query_store_report_*`) | **百分比** | 42.0 → 42% |

**根据字段名和工具描述判断**, 不要假设.

## 毛利率 / 净利率问题

用 `query_financial_overview` 读 `grossMarginRate` / `netProfitRate`, **不要**从原始收入/成本/费用自己算.

## vsPrevPeriod

`query_financial_overview` 的 `vsPrevPeriod` 字段是**环比变化** (小数): 0.05 表示 +5pp. 负数表示下降. 不要跟当前期间的值混淆.

## 净利润口径

净利润**排除** `EXP_OTHER` / `BONUS` (分红/奖金). 其他 `EXP_OTHER` (TAX, REPAY, REFUND) **包含**在内. 用户问"分红/股东分红/bonus payouts" 时排除; 否则按字段自然口径.
