# 财务报表页 — 页面结构

路由：`/u/financial`  
文件：[ui/src/app/u/financial/page.tsx](ui/src/app/u/financial/page.tsx)

---

## 1. 顶层布局

```
Page (FinancialPage, 'use client')
├── 控制栏 [顶部]
│   ├── 时间粒度选择 (按月/按季/按年)     → span state
│   ├── 期间选择 (默认当前期间)            → period state
│   └── 门店选择                           → store state
│
├── 收付实现制提示条 [淡黄色静态横幅]
│
├── OverviewPanel
│   └── 6个KPI卡片网格 (3列)
│       ├── 营业收入 (含环比箭头)
│       ├── 毛利率 (含环比箭头)
│       ├── 净利润率 (含环比箭头)
│       ├── 经营性现金流 (含状态标签)
│       ├── 期末现金余额 (含可支撑月数)
│       └── 店均营收 (含门店数)
│
├── Tab 导航栏
│   ├── 利润表 (ProfitStatement)
│   ├── 现金流量表 (CashflowStatement)
│   └── 资产负债表 (BalanceSheet)
│
└── Tab 内容区
    ├── ProfitStatement  → 利润表视图
    ├── CashflowStatement → 现金流量表视图
    └── BalanceSheet     → 资产负债表视图
```

## 2. 子页面: `/u/payment` 付款分析

文件：[ui/src/app/u/payment/page.tsx](ui/src/app/u/payment/page.tsx)

```
Page (PaymentPage, 'use client')
├── 控制栏 (同 financial)
├── 付款指标区块
│   ├── 3个KPI卡片 (付款总金额 + top2分类)
│   ├── Lvl1 分类占比条
│   └── 月度趋势柱状图 (近12月)
├── 左栏: 对方科目列表 (w-80)
│   ├── 搜索框 → 按名称过滤
│   ├── 按 lvl1_name 分组
│   └── 每项: 名称 / 总金额 / 笔数
└── 右栏: 交易流水明细
    ├── 期间汇总
    └── 按月分组交易表格
```

## 3. 子页面: `/u/dashboard` 经营看板

文件：[ui/src/app/u/dashboard/page.tsx](ui/src/app/u/dashboard/page.tsx)

```
Page (DashboardPage, 'use client')
├── 控制栏 (PeriodSelector + store)
├── KPI 卡片网格 (9卡片)
│   ├── 4个可点击KPI (设置活跃趋势)
│   └── 5个辅助指标
├── 趋势图表 (按活跃KPI切换)
├── 费用明细 (可折叠, 按lvl1/lvl2, 环比)
└── 底部双列
    ├── 数据健康 (门店+最新交易日期)
    └── 快速链接 (4个导航卡片)
```

### 3.1 全量模式

PeriodSelector 月/季/年下拉首项为"全部",选中后 `period='all'`。语义:
- 金额型 KPI(营收 / 费用 / 经营现金流)= 品牌或门店全量 SUM
- 比率型 KPI(毛利率 / 净利率)= 全量加权平均
- 趋势图 = 全部历史月柱图
- vs 同期(↑↓)= 隐藏(全量无对比期)
- 银行入账率 = 始终显示,分子分母全量 SUM

门店维度不变:`store='all'` = 品牌汇总,`store='<code>'` = 该门店。

## 4. 常见API调用模式

所有 financial 相关页面遵循同一模式：
- 使用 `useBrand()` context 获取品牌
- filter (span/period/store) 变化 → useEffect 重新获取数据
- 无外部状态库，全部 `useState` + `fetch()`
