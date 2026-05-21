# 三大财务报表模块设计

## 1. 概述

在现有 Next.js UI 中新增"财务报表"功能模块，基于已分类的银行流水数据，为各品牌生成标准的**利润表**、**现金流量表**、**资产负债表**。

## 2. 范围

### 包含
- 三大财务报表的 SQL 视图（每个品牌 schema 下 3 个视图）
- 3 个专用 API 端点
- UI 财务报表页面（3 个 Tab + 筛选条件）
- 支持月/季/年三种时间跨度

### 不包含
- 期初余额处理（从 0 开始累计）
- 跨品牌合并报表
- 导出功能（PDF/Excel）
- 长短期负债区分（从银行流水无法区分到期日）

## 3. 技术选型

- **前端**: Next.js 14 (React) + TailwindCSS — 与现有 UI 统一技术栈
- **API**: Next.js API Routes — 3 个独立端点
- **数据**: PostgreSQL 视图 + SQL 查询 — 按品牌 schema 隔离
- **数据库连接**: 现有 `pg.Pool` 连接池复用

## 4. 数据架构

### 4.1 SQL 视图

每个品牌 dm schema 下新增 3 个视图:

#### `v_profit_statement`
按月、按门店、按分类聚合。返回字段：
- `month`, `store_code`, `section` (revenue/cost/expense/profit)
- `lvl1_code`, `lvl1_name`, `lvl2_code`, `lvl2_name`
- `amount` (入账为正，出账为负)
- `sort_order`, `indent_level`

#### `v_cashflow_statement`
将分类流水映射到三大现金流活动：
- **经营活动**: REV_BIZ 收入 - 经营费用 (HR, MATERIAL, RENT_UTIL, MKT, ADMIN, SHIP, EXP_OTHER)
- **投资活动**: BUILD (营建), INVEST_IN (注资)
- **筹资活动**: LOAN_IN (贷款), BORROW_IN (借款), EXP_OTHER.REPAY (还款)

返回字段：
- `month`, `store_code`, `activity` (operating/investing/financing)
- `category`, `amount`, `sort_order`, `indent_level`

#### `v_balance_sheet`
从 0 开始累计，每月末时点数据：
- **资产**: 银行存款余额（累计净现金流）
- **负债**: 未偿还贷款/借款
- **权益**: 实收资本 + 累计留存收益

返回字段：
- `month`, `store_code`, `section` (asset/liability/equity)
- `item`, `amount`, `sort_order`, `indent_level`

### 4.2 API 端点

| 端点 | 方法 | 参数 | 响应 |
|---|---|---|---|
| `/api/financial/profit` | GET | brand, period, span, store | 利润表行项目数组 |
| `/api/financial/cashflow` | GET | brand, period, span, store | 现金流量表行项目数组 |
| `/api/financial/balance-sheet` | GET | brand, period, span, store | 资产负债表行项目数组 |

参数说明：
- `brand`: 品牌代码（如 gelatomiiix）
- `period`: 期间（月: 2026-01, 季: 2026-Q1, 年: 2026）
- `span`: 跨度（month/quarter/year）
- `store`: 门店代码（all 或具体门店）

时间跨度处理：
- **月**: 只查该月数据
- **季**: 汇总结算该季 3 个月数据
- **年**: 汇总结算该年 12 个月数据

返回格式统一：
```json
{
  "success": true,
  "data": {
    "brand": "gelatomiiix",
    "period": "2026-01",
    "span": "month",
    "store": "all",
    "lines": [
      { "section": "revenue", "label": "一、营业收入", "amount": 100000.00, "indent": 0, "is_subtotal": false, "is_highlight": false },
      { "section": "revenue_detail", "label": "  美团", "amount": 50000.00, "indent": 1, "is_subtotal": false, "is_highlight": false },
      { "section": "revenue_detail", "label": "  微信/财付通", "amount": 30000.00, "indent": 1, "is_subtotal": false, "is_highlight": false },
      { "section": "revenue", "label": "营业收入合计", "amount": 100000.00, "indent": 0, "is_subtotal": true, "is_highlight": false },
      { "section": "gross_profit", "label": "毛利", "amount": 40000.00, "indent": 0, "is_subtotal": false, "is_highlight": true },
      { "section": "net_profit", "label": "净利润", "amount": 20000.00, "indent": 0, "is_subtotal": false, "is_highlight": true }
    ]
  }
}
```

## 5. UI 设计

### 5.1 导航

在现有导航栏 `<NavBar>` 中新增链接：
```
首页 | Pipeline 监控 | 规则管理 | 人工匹配 | 文件上传 | 财务报表 | 配置(admin)
```

### 5.2 页面布局

```
┌──────────────────────────────────────────────────────────┐
│  品牌: [gelatomiiix ▼]  跨度: [月 ▼]  期间: [2026-01 ▼]  门店: [全部 ▼] │
│  ┌──────────┬──────────────┬──────────────┐              │
│  │  利润表   │  现金流量表   │  资产负债表   │              │
│  ├──────────┴──────────────┴──────────────┤              │
│  │                                         │              │
│  │  利润表内容...                           │              │
│  │                                         │              │
│  └─────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

### 5.3 筛选条件

- **跨度选择**: 月 / 季度 / 年（切换后期间下拉联动变化）
- **期间选择**: 根据跨度显示月份/季度/年份下拉
- **门店选择**: 该品牌下门店列表，含"全部"选项

### 5.4 财务报表表格渲染规则

- 使用统一 `StatementTable` 组件
- **缩进**: indent=1 的行比 indent=0 的行缩进
- **小计**: is_subtotal=true 的行加粗
- **高亮**: is_highlight=true 的行加粗 + 浅色背景
- 负数金额显示为红色

### 5.5 利润表行项目结构

```
一、营业收入              xxx,xxx        ← section: revenue
  美团                     xx,xxx        ← indent: 1
  微信/财付通               xx,xxx
  支付宝                    xx,xxx
  抖音                      xx,xxx
  饿了么                    xx,xxx
  京东                      xx,xxx
  其他渠道                  xx,xxx
营业收入合计               xxx,xxx        ← is_subtotal: true

二、营业成本               xxx,xxx
  材料采购                  xx,xxx
  运费                      xx,xxx
营业成本合计               xxx,xxx

毛利                      xxx,xxx        ← is_highlight: true

三、期间费用               xxx,xxx
  人力                      xx,xxx
  租金物业                  xx,xxx
  营销费用                  xx,xxx
  管理费用                  xx,xxx
  其他费用                  xx,xxx
  营建费用                  xx,xxx
期间费用合计               xxx,xxx

四、净利润                 xxx,xxx        ← is_highlight: true
```

### 5.6 现金流量表行项目结构

```
一、经营活动产生的现金流量
  销售商品收到的现金        xxx,xxx
  收到的其他经营收入         xx,xxx
  经营活动现金流入小计      xxx,xxx
  购买商品支付的现金       (xx,xxx)
  支付给职工的现金         (xx,xxx)
  支付的各项税费           (xx,xxx)
  支付的其他经营费用       (xx,xxx)
  经营活动现金流出小计     xxx,xxx
经营活动产生的现金流量净额  xxx,xxx        ← highlighted

二、投资活动产生的现金流量
  购建固定资产支付的现金    (xx,xxx)
投资活动产生的现金流量净额  xxx,xxx        ← highlighted

三、筹资活动产生的现金流量
  吸收投资收到的现金         xx,xxx
  取得借款收到的现金         xx,xxx
  偿还债务支付的现金        (xx,xxx)
筹资活动产生的现金流量净额  xxx,xxx        ← highlighted

四、现金净增加额            xxx,xxx        ← highlighted
```

### 5.7 资产负债表行项目结构

```
资产
  货币资金                  xxx,xxx        ← 累计净现金流（所有 in - 所有 out）
资产总计                   xxx,xxx        ← highlighted

负债
  借款                      xx,xxx        ← LOAN_IN + BORROW_IN - REPAY (累计)
负债总计                   xxx,xxx        ← highlighted

所有者权益
  实收资本                  xx,xxx        ← INVEST_IN (累计)
  未分配利润                xx,xxx        ← 累计净利润
所有者权益总计              xxx,xxx        ← highlighted

负债和所有者权益总计        xxx,xxx        ← highlighted, 应与资产总计相等
```

## 6. 组件树

```
FinancialPage
├── PeriodSelector (跨度/期间/门店筛选)
├── TabBar (利润表 | 现金流量表 | 资产负债表)
├── ProfitStatement
│   └── StatementTable (通用财务表格)
├── CashflowStatement
│   └── StatementTable
└── BalanceSheet
    └── StatementTable
```

## 7. 数据流

```
用户选择品牌/期间/门店
  → FinancialPage 更新筛选状态
  → 当前 Tab 组件发起 API 请求
  → API Route 查询 SQL 视图
  → API 编排行项目格式（含跨度汇总逻辑）
  → UI 渲染 StatementTable
```

## 8. 实施计划

### Phase 1: SQL 视图（gelatomiiix 品牌）
1. 创建 `v_profit_statement` 视图
2. 创建 `v_cashflow_statement` 视图
3. 创建 `v_balance_sheet` 视图

### Phase 2: API 端点
1. 创建 `api/financial/profit/route.ts`
2. 创建 `api/financial/cashflow/route.ts`
3. 创建 `api/financial/balance-sheet/route.ts`

### Phase 3: UI 页面
1. 创建 `StatementTable` 通用组件
2. 创建 3 个报表 Tab 组件
3. 创建 `FinancialPage` 页面容器
4. 更新导航栏
