# 关键结果快照 - Yufeng DM 视图验收

本文档定义 Yufeng 数据中台 DM 层关键视图的验收查询与预期形态。
**注**：以下为可复现的查询模板；本次真实跑通记录见：`docs/REAL_RUN_2026-03-22.md`。

---

## a) yufeng_dm.revenue_monthly（收入月报）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| month | varchar(7) | 月份，格式 YYYY-MM |
| biz_revenue_amt | numeric | 业务口径收入（当前为空，待营业数据导入后填充） |
| bank_revenue_amt | numeric | 银行口径收入：lvl1='营业收入' 的 in_amt 汇总 |
| diff_amt | numeric | 差异：bank_revenue_amt - biz_revenue_amt（业务-银行） |

### 示例查询

```sql
-- 查询月度收入（含两口径与差异）
SELECT * FROM yufeng_dm.revenue_monthly ORDER BY month DESC;

-- 单独查看银行口径收入趋势
SELECT month, bank_revenue_amt
FROM yufeng_dm.revenue_monthly
ORDER BY month DESC;
```

### 验收关注点

| 检查项 | 预期 | 异常情况 |
|--------|------|----------|
| month 格式 | YYYY-MM（如 2025-03） | 包含时间戳或 NULL |
| bank_revenue_amt | >= 0 | 负值 → 需检查 in_amt 方向是否错误 |
| biz_revenue_amt | 当前为 NULL（待营业数据导入） | - |
| diff_amt | 当前为 NULL（因 biz_revenue_amt 为空） | 若业务数据就绪后出现大额差异，需核对口径 |

---

## b) yufeng_dm.expense_monthly（费用月报）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| month | varchar(7) | 月份 |
| lvl1 | varchar | 费用一级分类（如：人力成本、租金物业、运费、销售费用、管理费用、财务费用、税金支出、材料采购） |
| lvl2 | varchar | 费用二级分类 |
| total_out_amt | numeric | 该分类的支出总额 |
| txn_rows | bigint | 流水笔数 |

### 示例查询

```sql
-- 查询费用分类明细（按月+分类）
SELECT * FROM yufeng_dm.expense_monthly ORDER BY month DESC, total_out_amt DESC;

-- 按月汇总总费用
SELECT month, sum(total_out_amt) AS total_expense_amt
FROM yufeng_dm.expense_monthly
GROUP BY month
ORDER BY month DESC;

-- 查看费用 Top 10（所有月份汇总）
SELECT lvl1, lvl2, sum(total_out_amt) AS total_amt, sum(txn_rows) AS total_rows
FROM yufeng_dm.expense_monthly
GROUP BY lvl1, lvl2
ORDER BY total_amt DESC
LIMIT 10;

-- 单独查看某月费用分布
SELECT lvl1, sum(total_out_amt) AS amt
FROM yufeng_dm.expense_monthly
WHERE month = '2025-03'
GROUP BY lvl1
ORDER BY amt DESC;
```

### 验收关注点

| 检查项 | 预期 | 异常情况 |
|--------|------|----------|
| lvl1 分类完整性 | 包含核心分类（人力/租金/运费/管理/财务/税金/材料） | 缺失常见分类 → 规则未覆盖 |
| total_out_amt | >= 0 | 负值 → out_amt 方向或分类逻辑错误 |
| 未分类占比 | unclassified_rows / total_rows 应呈下降趋势 | 覆盖率过低时需补充规则 |
| lvl2 空值 | 可为空（部分一级分类无二级） | - |

---

## c) yufeng_dm.profit_monthly（利润月报）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| month | varchar(7) | 月份 |
| bank_revenue_amt | numeric | 银行口径收入（lvl1='营业收入' 的 in_amt 汇总） |
| total_expense_amt | numeric | 银行口径费用（所有 out_amt 汇总） |
| profit_amt | numeric | 利润 = bank_revenue_amt - total_expense_amt |
| biz_revenue_amt | numeric | 业务口径收入（当前为空） |
| diff_amt | numeric | 收入差异（当前为空） |

### 示例查询

```sql
-- 查询月度利润
SELECT * FROM yufeng_dm.profit_monthly ORDER BY month DESC;

-- 利润趋势
SELECT month, bank_revenue_amt, total_expense_amt, profit_amt
FROM yufeng_dm.profit_monthly
ORDER BY month DESC;
```

### 验收关注点

| 检查项 | 预期 | 异常情况 |
|--------|------|----------|
| profit_amt 计算 | = bank_revenue_amt - total_expense_amt | 数值不匹配 → SQL 逻辑错误 |
| bank_revenue_amt | >= 0 | 负值 → 收入分类方向错误 |
| total_expense_amt | >= 0 | 负值 → 支出分类方向错误 |
| 合理性 | profit_amt 应在合理范围（不至于极端大额亏损） | 极端负值 → 检查是否有错误分类（如把收入归为支出） |
| biz_revenue_amt / diff_amt | 当前为 NULL | 非 NULL 时需验证与 bank 口径差异是否合理 |

---

## d) 覆盖率与未分类 TopN

### d.1) yufeng_dm.v_coverage_monthly（覆盖率月度统计）

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| month | varchar(7) | 月份 |
| total_rows | bigint | 当月总流水笔数 |
| covered_rows | bigint | 已分类笔数（override + rule） |
| unclassified_rows | bigint | 未分类笔数 |
| coverage_rate_rows | numeric | 笔数覆盖率（%） |
| total_in_amt | numeric | 转入金额总额 |
| covered_in_amt | numeric | 已分类转入金额 |
| unclassified_in_amt | numeric | 未分类转入金额 |
| coverage_rate_in_amt | numeric | 转入金额覆盖率（%） |
| total_out_amt | numeric | 转出金额总额 |
| covered_out_amt | numeric | 已分类转出金额 |
| unclassified_out_amt | numeric | 未分类转出金额 |
| coverage_rate_out_amt | numeric | 转出金额覆盖率（%） |

#### 示例查询

```sql
-- 查看最近 3 个月覆盖率
SELECT * FROM yufeng_dm.v_coverage_monthly ORDER BY month DESC LIMIT 3;

-- 查看所有月份覆盖率趋势
SELECT month, coverage_rate_rows, coverage_rate_in_amt, coverage_rate_out_amt
FROM yufeng_dm.v_coverage_monthly
ORDER BY month DESC;
```

#### 验收关注点

| 检查项 | 预期 | 异常情况 |
|--------|------|----------|
| covered_rows <= total_rows | 恒成立 | 违反 → SQL 逻辑错误 |
| coverage_rate_rows | 越高越好（目标 95%+） | 持续低于 80% → 需补充规则 |
| coverage_rate_out_amt vs coverage_rate_rows | 金额覆盖率通常低于笔数覆盖率（大额流水未分类影响更大） | 金额覆盖率远低于笔数 → 优先处理大额未分类 |
| 趋势 | 覆盖率应逐月提升或稳定 | 突然下降 → 新数据源未覆盖或规则失效 |

---

### d.2) yufeng_dm.v_unclassified_top（未分类 TopN）

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| month | varchar(7) | 月份 |
| counterparty_name | varchar | 对方单位名称 |
| summary | varchar | 摘要 |
| memo | varchar | 附言/备注 |
| combined_text | varchar | 组合关键词（counterparty_name \| summary \| memo） |
| txn_rows | bigint | 该组合的流水笔数 |
| in_amt | numeric | 转入金额合计 |
| out_amt | numeric | 转出金额合计 |
| total_amt | numeric | 金额合计（in + out） |

#### 示例查询

```sql
-- 未分类 Top 20（所有月份）
SELECT * FROM yufeng_dm.v_unclassified_top LIMIT 20;

-- 未分类 Top 20（指定月份）
SELECT * FROM yufeng_dm.v_unclassified_top WHERE month = '2025-03' LIMIT 20;

-- 仅看大额未分类（按金额排序）
SELECT * FROM yufeng_dm.v_unclassified_top ORDER BY total_amt DESC LIMIT 20;

-- 按月份分别看 Top 10
SELECT * FROM (
    SELECT *, row_number() OVER (PARTITION BY month ORDER BY total_amt DESC) as rn
    FROM yufeng_dm.v_unclassified_top
) t
WHERE rn <= 10
ORDER BY month DESC, total_amt DESC;
```

#### 验收关注点

| 检查项 | 预期 | 异常情况 |
|--------|------|----------|
| 结果可为空 | 当 coverage_rate=100% 时应返回空 | 有数据但无未分类 → 可能逻辑错误 |
| total_amt 排序 | 默认按 txn_rows + total_amt 排序 | - |
| 高频小額 vs 低频大额 | 优先处理高金额未分类（ROI 更高） | - |
| combined_text | 可用于快速构建规则关键词 | 全部为 NULL → 流水原始字段可能有问题 |

---

## 验证检查清单

### 基础可用性

- [ ] `SELECT * FROM yufeng_dm.revenue_monthly;` 可执行，返回预期列
- [ ] `SELECT * FROM yufeng_dm.expense_monthly;` 可执行，返回预期列
- [ ] `SELECT * FROM yufeng_dm.profit_monthly;` 可执行，返回预期列
- [ ] `SELECT * FROM yufeng_dm.v_coverage_monthly;` 可执行
- [ ] `SELECT * FROM yufeng_dm.v_unclassified_top;` 可执行

### 数据逻辑

- [ ] revenue_monthly: bank_revenue_amt >= 0
- [ ] expense_monthly: total_out_amt >= 0
- [ ] profit_monthly: profit_amt = bank_revenue_amt - total_expense_amt
- [ ] v_coverage_monthly: covered_rows <= total_rows
- [ ] v_coverage_monthly: coverage_rate_* 在 0-100 之间

### 业务合理性

- [ ] 收入、费用、利润数值在合理范围（非极端）
- [ ] 覆盖率趋势稳定或提升
- [ ] 未分类 TopN 可用于补充规则

---

## 文档信息

- 目标视图：yufeng_dm.revenue_monthly / expense_monthly / profit_monthly / v_coverage_monthly / v_unclassified_top
- 依赖：yufeng_ods.bank_txn, yufeng_dm.v_bank_txn_classified, yufeng_cfg.bank_rule_map
- 用途：POC 验收、端到端结果确认
