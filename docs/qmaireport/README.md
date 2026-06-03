# Qimai Report — 文档索引 & 审计摘要

---

## 文档清单

| 页面组 | 页面结构 | 数据来源 | 用户故事 | 说明 |
|---|---|---|---|---|
| [收入分析](income-page-structure.md) | ✅ | ✅ | ✅ | /u/income 收入分析页 |
| [财务报表](financial-page-structure.md) | ✅ | ✅ | ✅ | /u/financial, /u/payment, /u/dashboard |
| [销售分析](sales-page-structure.md) | ✅ | ✅ | ✅ | /u/sales, /u/sales/details |
| [数据上传 & 管道监控](pipeline-page-structure.md) | ✅ | ✅ | ✅ | /upload, /pipeline |
| [手动匹配 & 规则管理](match-page-structure.md) | ✅ | ✅ | ✅ | /match, /rules |

---

## 全站银行数据使用审计结果

### 规范定义

**所有与银行流水相关的数据分析 API 必须使用 `bank_txn_classified_snapshot`（预分类快照），不得独立执行 `bank_rule_map` 模糊匹配或直接调用 `fn_classify()`。**

仅以下情况可访问原始 `bank_txn`：
- 规则管理操作（创建/编辑/删除规则时读取单行）
- 覆盖分类写入（bank_txn_override）
- 匹配预览（管理辅助工具）
- 管道触发操作（refresh_bank_txn_classified_snapshot）

### 审计结果：全部 API 路由

| 路由 | 状态 | 备注 |
|---|---|---|
| **financial/** | | |
| income-metrics | ✅ | v_cashflow_statement |
| counterparty | ✅ | JOIN classified_snapshot |
| profit | ✅ | v_profit_statement |
| cashflow | ✅ | v_cashflow_statement |
| balance-sheet | ✅ | v_balance_sheet |
| overview | ✅ | 多视图聚合 |
| payment-metrics | ✅ | v_cashflow_statement |
| kpi-trend | ✅ | JOIN classified_snapshot |
| qimai-revenue | ✅ | v_profit_statement |
| **{brand}/income/** | | |
| gelatomiiix/bank-entry-stats | ✅ | **已修复:** 改为使用 classified_snapshot |
| bonjur/bank-entry-stats | ✅ | 已经是 classified_snapshot |
| **pipeline/** | | |
| kpi | ✅ | **已修复:** 改为使用 classified_snapshot (原硬编码0) |
| rerun-match-by-file | ✅ | 管理操作 |
| **match/** | | |
| candidates | ✅ | 管理操作 (单行读取) |
| override | ✅ | 管理操作 |
| preview | ✅ | **已修复:** 品牌表名动态解析 + 正确列名 |
| route | ✅ | 管理操作 |
| **rules/** | | |
| route | ✅ | 管理操作 |
| settle | ✅ | 管理操作 (写入+触发分类) |
| settle-batch | ✅ | 管理操作 |
| history | ✅ | 管理操作 |
| rollback | ✅ | 管理操作 |
| **approval/** | | |
| proposals | ✅ | 管理操作 (审批工作流) |
| **admin/** | | |
| brands / rules-* | ✅ | 管理员操作 |
| **upload/** |||
| route | ✅ | 导入操作 (触发分类) |

### 本次修复清单

| 文件 | 问题 | 修复内容 |
|---|---|---|
| [bank-entry-stats/route.ts](../../ui/src/app/api/gelatomiiix/income/bank-entry-stats/route.ts) | 独立 ILIKE 匹配 bank_rule_map → 口径差异 | 改为 JOIN bank_txn_classified_snapshot |
| [pipeline/kpi/route.ts](../../ui/src/app/api/pipeline/kpi/route.ts) | 直接读 raw bank_txn, 未分类KPI硬编码0 | 改为 JOIN bank_txn_classified_snapshot |
| [match/preview/route.ts](../../ui/src/app/api/match/preview/route.ts) | 硬编码 yufeng_ods, 错误列名 lvl1/lvl2 | 动态表名解析 + 修正列名 |

### 不受影响的数据

以下页面/API 不涉及银行流水，不适用本规范：
- **销售分析** (/u/sales, /u/sales/details) — 数据源为 Qimai 订单 / 收银系统
- **登录/认证** (/login, /api/auth/*)
- **门店管理** (admin/stores)
- **用户管理** (admin/users)

---

## 新品牌采纳规范 checklist

新增品牌时，以下基础设施必须齐备：

- [ ] `{brand}_cfg.dim_category_lvl1` / `dim_category_lvl2` (分类体系)
- [ ] `{brand}_cfg.bank_rule_map` (规则表)
- [ ] `{brand}_dm.fn_classify_bank_txn_v2()` (分类函数)
- [ ] `{brand}_dm.bank_txn_classified_snapshot` (预分类快照 BASE TABLE)
- [ ] `refresh_bank_txn_classified_snapshot()` (刷新函数)
- [ ] `{brand}_dm.v_cashflow_statement` / `v_profit_statement` / `v_balance_sheet` (财务视图)
- [ ] 所有 API 读取上述快照/视图，不做独立分类匹配
