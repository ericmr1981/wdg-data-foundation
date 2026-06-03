# 收入分析页 — 页面结构

路由：`/u/income`  
文件位置：[ui/src/app/u/income/page.tsx](ui/src/app/u/income/page.tsx)

---

## 1. 顶层布局

```
Page (PaymentPage, 'use client')
├── 控制栏 [顶部]
│   ├── 时间粒度选择 (按月/按季/按年)         → span state
│   ├── 期间选择 (全部 / 具体月份/季度/年)      → period state
│   └── 门店选择 (全部门店 / 具体门店)          → store state
│
├── 区块A: 收入概览 [条件渲染: metrics != null]
│   ├── 卡片1: 收款总金额    —— 所有 lvl1 net_amount > 0 的总和
│   ├── 卡片2: 营业收入       —— top 1 lvl1 (REV_BIZ)
│   ├── 卡片3: 其他收入       —— top 2 lvl1 (REV_OTHER)
│   └── 二级分类占比条        —— 全部 lvl2 的金额/占比列表
│
├── 区块B: 银行入账率 [条件渲染: brand === 'gelatomiiix' || 'bonjur']
│   └── BankEntryRateSection 子组件
│       ├── 渠道入账率卡片 (grid 3列)
│       │   └── 每卡片: 渠道名 / 企迈实收额 / 银行入账额 / 入账率%
│       └── 月度趋势折线图 (企迈实收 vs 银行入账)
│
├── 区块C: 对方科目明细
│   ├── 左栏: 对方科目列表 (w-80)
│   │   ├── 搜索框 (按 counterparty_name 过滤)
│   │   ├── 按 lvl1_name 分组
│   │   └── 每项: 科目名 / 总金额 / 笔数
│   └── 右栏: 交易流水明细 (选中科目后展示)
│       ├── 期间汇总: "XX | 所选期间合计：XXX 元（N笔）"
│       └── 按月分组的交易表格
│           └── 列: 时间 | 门店 | 用途 | 摘要 | 附言 | 金额 | 分类
│
└── 空状态 / 加载 / 错误处理 (各区块独立)
```

## 2. 状态管理 (useState)

| State | 类型 | 初始值 | 用途 |
|---|---|---|---|
| `span` | `'month'\|'quarter'\|'year'` | `'month'` | 时间粒度 |
| `period` | `string` | `'all'` | 期间筛选 |
| `store` | `string` | `'all'` | 门店筛选 |
| `stores` | `{code,name}[]` | `[]` | 门店选项列表 |
| `counterparties` | `CounterpartySummary[]` | `[]` | 区块C左栏列表 |
| `selected` | `string` | `''` | 当前选中的科目名 |
| `txns` | `TxnDetail[]` | `[]` | 区块C右栏流水 |
| `periodTotal` / `periodCount` | `number` | `0` | 选中科目的期间汇总 |
| `loading` / `error` | `boolean\|string` | `true\|null` | 区块C左栏状态 |
| `detailLoading` | `boolean` | `false` | 区块C右栏状态 |
| `metrics` / `metricsLoading` | `IncomeLvl1[]+IncomeLvl2[]\|null` | `null\|false` | 区块A数据 |

## 3. 副作用 (useEffect)

### useEffect 1 — 门店列表
- 触发: brand 变化
- API: `GET /api/stores?brand={brand}`
- 数据源表: `ops.stores`

### useEffect 2 — 收入概览 (区块A)
- 触发: brand / period / span / store 变化
- API: `GET /api/financial/income-metrics?brand=&period=&span=&store=`

### useEffect 3 — 对方科目列表 (区块C左栏)
- 触发: brand / period / span / store 变化
- API: `GET /api/financial/counterparty?brand=&direction=in&period=&span=&store=`

### useEffect 4 — 科目流水详情 (区块C右栏)
- 触发: brand / selected / period / span / store 变化
- API: `GET /api/financial/counterparty?brand=&direction=in&counterparty={name}&period=&span=&store=`

## 4. 子组件: BankEntryRateSection

| State | 初始值 | 用途 |
|---|---|---|
| `data` | `null` | 包含 channels / monthly_trend / unmatched_orders |
| `loading` | `false` | 加载状态 |
| `error` | `null` | 错误信息 |

- 触发: brand / span / period / store 变化
- API: `GET /api/{brand}/income/bank-entry-stats?brand=&span=&period=&store=`

## 5. 计算逻辑

- `periodOptions`: 根据 span 生成可选期间列表（2025-03 至 2026-06）
- `filtered`: 按 search 文本过滤 counterparty 列表
- `monthlyGroups`: 将流水明细按月分组并计算小计
- 入账率卡片过滤: `data.channels` 排除 TOTAL / OTHER / ELEME
