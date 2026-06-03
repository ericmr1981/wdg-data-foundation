# 收入分析页 — 数据来源清单

---

## API 调用总览

| 区块 | API | 用途 | 数据源系统 |
|---|---|---|---|
| 控制栏 | `GET /api/stores` | 门店筛选选项 | ops |
| 区块A | `GET /api/financial/income-metrics` | 收入金额概览 + 分类占比 | 银行流水 (ods.bank_txn) |
| 区块B | `GET /api/{brand}/income/bank-entry-stats` | 银行入账率分析 | Qimai 订单 + 银行流水 |
| 区块C | `GET /api/financial/counterparty` | 对方科目列表 & 流水明细 | 银行流水 (ods.bank_txn) |

---

## API 1: stores — 门店列表

**文件:** [ui/src/app/api/stores/route.ts](ui/src/app/api/stores/route.ts)

| 项 | 内容 |
|---|---|
| 查询表 | `ops.stores` |
| 过滤条件 | `brand_code=$1 AND enabled=true` |
| 排序 | `sort_order NULLS LAST, store_code` |
| 返回字段 | `store_code, store_name` |

---

## API 2: income-metrics — 收入概览

**文件:** [ui/src/app/api/financial/income-metrics/route.ts](ui/src/app/api/financial/income-metrics/route.ts)

### 数据流

```
brand_gelatomiiix_ods.bank_txn
  → fn_classify_bank_txn_v2() 规则分类
  → brand_gelatomiiix_dm.bank_txn_classified_snapshot
  → brand_gelatomiiix_dm.v_cashflow_statement  (聚合视图)
  → API 查询视图
```

### 查询细节

**主查询 (lvl1 + lvl2 收入):**
```sql
SELECT lvl1_code, sum(net_amount) as amount
FROM {dmSchema}.v_cashflow_statement
WHERE net_amount > 0 {dateClause} {storeClause}
GROUP BY lvl1_code
```

### 视图: v_cashflow_statement

**文件:** [sql/40_gelatomiiix_financial_statements.sql:76-133](sql/40_gelatomiiix_financial_statements.sql#L76)

| 字段 | 来源 |
|---|---|
| `month` | `date_trunc('month', bank_txn.txn_time)` |
| `store_code` | `bank_txn.store_code` |
| `activity` | 基于 lvl1_code 的 CASE WHEN (operating/investing/financing) |
| `lvl1_code` | `bank_txn_classified_snapshot.lvl1_code` |
| `lvl2_code` | `bank_txn_classified_snapshot.lvl2_code` |
| `total_in` | `sum(bank_txn.in_amt)` |
| `total_out` | `sum(bank_txn.out_amt)` |
| `net_amount` | `sum(in_amt - out_amt)` |
| `txn_rows` | `count(*)` |

**分类快照来源:** `bank_txn_classified_snapshot.classified_source IN ('rule', 'override')`

**分类维度:**
- `dim_category_lvl1`: lvl1_code, lvl1_name, direction, sort_order
- `dim_category_lvl2`: lvl1_code, lvl2_code, lvl2_name, sort_order

**分类体系 (gelatomiiix):** [参见 category_dictionary](sql/10_yufeng_category_dictionary.sql)

```
lvl1: REV_BIZ  (营业收入, in)    → lvl2: MEITUAN / ELEME / DOUYIN / JD / WECHAT / ALIPAY / UNIONPAY / OTHER_CH
lvl1: REV_OTHER (其他收入, in)   → lvl2: INVEST_IN / BORROW_IN / LOAN_IN / INTEREST_IN / TAX_REFUND / REFUND_IN
lvl1: MATERIAL  (物料成本, out)  → ...
lvl1: HR        (人工成本, out)   → ...
lvl1: RENT_UTIL (房租水电, out)  → ...
lvl1: MKT       (营销费用, out)   → ...
lvl1: ADMIN     (管理费用, out)  → ...
lvl1: SHIP      (物流运费, out)  → ...
lvl1: TAX_SURCHARGE (税金, out) → ...
lvl1: EXP_OTHER (其他支出, out) → ...
lvl1: BUILD     (建设投资, out)  → ...
```

### 时间过滤逻辑 (parsePeriod)

**文件:** [ui/src/app/api/financial/period-utils.ts](ui/src/app/api/financial/period-utils.ts)

income-metrics 使用 **累计截止**（cumulative up to period end）模式：
- `dateClause = 'AND month < $1::date'`（小于期间结束日）
- `params = [periodEnd]`
- 即：选"2026-04"时，汇总截至 2026-04-01 之前的所有数据

---

## API 3: counterparty — 对方科目列表 & 明细

**文件:** [ui/src/app/api/financial/counterparty/route.ts](ui/src/app/api/financial/counterparty/route.ts)

### 数据流

```
brand_gelatomiiix_ods.bank_txn  (通过 getOdsBankTxnTable 获取表名)
  → brand_gelatomiiix_dm.bank_txn_classified_snapshot  (分类结果)
  → brand_gelatomiiix_cfg.dim_category_lvl1  (分类名称)
  → API 直接 JOIN 查询
```

⚠️ **注意:** 此 API **不** 使用 v_cashflow_statement 视图，而是直接 JOIN 源表。

### 查询: 对方科目列表

```sql
SELECT
  CASE
    WHEN counterparty_name IS NOT NULL AND '' THEN counterparty_name
    WHEN purpose IS NOT NULL AND '' AND purpose != 'NaN' THEN purpose
    WHEN summary IS NOT NULL AND '' THEN summary
    ELSE '（未知名）'
  END as counterparty_name,
  c.lvl1_code, l1.lvl1_name,
  sum(coalesce(t.{in_amt|out_amt}, 0)) as {total_received|total_paid},
  count(*) as txn_count,
  min(t.txn_time) as first_date,
  max(t.txn_time) as last_date
FROM {bankTxnTable} t
JOIN {dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
LEFT JOIN {cfgSchema}.dim_category_lvl1 l1 ON l1.lvl1_code = c.lvl1_code
WHERE c.classified_source IN ('rule', 'override')
  AND coalesce(t.{in_amt|out_amt}, 0) > 0
  {dateClause} {storeClause}
GROUP BY counterparty_name (fallback chain), lvl1_code, lvl1_name
```

### 查询: 科目流水明细

同表 JOIN，额外 `WHERE (counterparty_name = $1 OR purpose = $1 OR summary = $1)`，返回每笔交易的全部字段。

### 对方名称的 Fallback 逻辑

1. `counterparty_name` 非空 → 使用
2. `purpose` 非空且非'NaN' → 使用
3. `summary` 非空 → 使用
4. 都为空 → `（未知名）`

### 金额字段

| direction=in | direction=out |
|---|---|
| `in_amt` | `out_amt` |
| `total_received` | `total_paid` |
| `period_received` | `period_total` |

---

## API 4: bank-entry-stats — 银行入账率

**文件:** [ui/src/app/api/gelatomiiix/income/bank-entry-stats/route.ts](ui/src/app/api/gelatomiiix/income/bank-entry-stats/route.ts)

### 数据源对比

**这是唯一同时查询两个独立数据源的 API。**

| 指标 | 数据源 | 表 | 过滤 |
|---|---|---|---|
| qimai_net_amt (企迈实收) | 平台订单 | `gelatomiiix_ods.income_detail` | `NOT is_refund AND NOT is_member_payment` |
| bank_entry_amt (银行入账) | 银行流水 | `brand_gelatomiiix_ods.v_bank_txn` | 通过 counterparty_name ILIKE 匹配 bank_rule_map |

### 子查询 1: 渠道企迈收入

```sql
SELECT
  CASE WHEN '微信支付' = ANY(payment_methods) THEN 'WECHAT'
       WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
       WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
       WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
       WHEN '抖音团购券' = ANY(payment_methods) THEN 'DOUYIN'
       WHEN '饿了么' = ANY(payment_methods) THEN 'ELEME'
       WHEN '京东支付' = ANY(payment_methods) THEN 'JD'
       ELSE 'OTHER'
  END AS channel,
  COALESCE(SUM(net_amt), 0) AS qimai_net_amt
FROM gelatomiiix_ods.income_detail
WHERE NOT is_refund AND NOT is_member_payment
```
— payment_methods 是数组字段，每个订单可有多维支付方式

### 子查询 2: 银行入账按渠道

```sql
SELECT c.lvl2_code AS channel,
       COALESCE(SUM(COALESCE(t.in_amt, 0)), 0) AS bank_entry_amt
FROM brand_gelatomiiix_ods.bank_txn t
JOIN brand_gelatomiiix_dm.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
WHERE c.classified_source IN ('rule', 'override')
  AND c.lvl1_code = 'REV_BIZ'
  AND COALESCE(t.in_amt, 0) > 0
GROUP BY c.lvl2_code
```
— 通过 `bank_txn_classified_snapshot` 预分类快照获取渠道标签，与 income-metrics / counterparty 口径完全一致
— ✅ 2026-06-03 修改: 从 `v_bank_txn JOIN bank_rule_map` 改为使用预分类快照，消除多口径差异

### 子查询 3: 月度趋势

```
qimai_monthly:   income_detail 按月 SUM(net_amt)
bank_monthly:    v_bank_txn JOIN bank_rule_map 按月 SUM(amount)
FULL OUTER JOIN → 合并输出
```

### 子查询 4: 未入账订单

```sql
SELECT month, channel, COUNT(*) AS order_count, SUM(net_amt) AS unentered_amt
FROM gelatomiiix_ods.income_detail
WHERE third_party_txn_no IS NULL        ← 无第三方交易号 = 未结算
  AND NOT is_refund AND NOT is_member_payment
```

### 入账率计算

`entry_rate = bank_entry_amt / qimai_net_amt * 100`

### 渲染过滤

UI 中 `BankEntryRateSection` 对 `data.channels` 过滤: 排除 TOTAL / OTHER / ELEME

---

## 完整数据血缘 (Data Lineage)

```
┌──────────────────────────────────────────────────────────────────┐
│ 系统A: 银行对账单 / 网银                                        │
│  → import 脚本                                                   │
│  → brand_gelatomiiix_ods.bank_txn (in_amt, out_amt, balance_amt)│
│    ├── fn_classify_bank_txn_v2()                                 │
│    │   └── bank_txn_classified_snapshot (lvl1/lvl2 tag)          │
│    │       ├── v_cashflow_statement (monthly agg)                │
│    │       │   └── income-metrics API                            │
│    │       └── counterparty API (直接 JOIN)                      │
│    └── v_bank_txn (amount 统一视图)                              │
│        └── bank-entry-stats API (JOIN bank_rule_map)             │
│                                                                  │
│ 系统B: Qimai (企迈) 平台                                         │
│  → import 脚本                                                   │
│  → gelatomiiix_ods.income_detail (net_amt, payment_methods[])    │
│    └── bank-entry-stats API (渠道维度 + 未入账订单)              │
│                                                                  │
│ 系统C: ops.stores (门店主数据)                                   │
│    └── stores API                                                │
└──────────────────────────────────────────────────────────────────┘
```

## 区块 A vs 区块 B 的数据差异

| 维度 | 区块A (收入概览) | 区块B (银行入账率) |
|---|---|---|
| **银行收入口径** | `v_cashflow_statement.net_amount` | `bank_txn.in_amt` JOIN bank_txn_classified_snapshot |
| **收入分类方式** | 分类快照 (规则引擎综合判定) | 分类快照 — 与区块A/C 口径一致 ✅ |
| **OTHER 的含义** | `lvl2_code=OTHER_CH` (非标准渠道的银行收款) | `payment_methods` 不在已知7种中的订单 |
| **时间过滤** | 累计截止 (month < period_end) | 严格期间 (txn_date < period_end) |
| **来源系统** | 仅银行流水 | Qimai订单金额 + 银行入账金额 双来源 |
