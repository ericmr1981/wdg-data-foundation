# Dashboard 全量模式设计

**日期**: 2026-07-19
**范围**: 仅 `/u/dashboard` 页(经营看板)
**作者**: Claude (brainstorming session)

## 1. 背景与目标

### 现状
- Dashboard 页 (`/u/dashboard`) 是经营看板,顶部两个核心控件:
  - `PeriodSelector`:月 / 季 / 年三档 + 具体年月下拉;**没有"全部"选项**
  - 门店 `<select>`:`全部门店`(默认)或具体 store_code
- 后端 API 已支持 `store='all'`(品牌汇总)和 `store='<code>'`(门店汇总),无需后端新增 store 维度逻辑
- 真实问题:**没有"不选具体月份"的入口**。`dashboard/page.tsx:426-437` 会在 brand 切换时自动选最近有数据的月份,用户根本不能"不选"

### 目标
让用户能在月 / 季 / 年三个维度各自选"全部",此时:
- **金额型 KPI**(营收 / 费用 / 经营现金流)= 品牌或门店全部历史 SUM
- **比率型 KPI**(毛利率 / 净利率)= 全量加权平均
- **趋势图** = 全生命周期月柱图
- **vs 同期(↑↓)** = 不显示(全量没有"对比期")
- **银行入账率** = 始终显示,分子分母全量 SUM
- 现有"选了具体月份"的行为**完全不变**(回归保护)

## 2. 用户故事

| # | 故事 | 验收 |
|---|---|---|
| 1 | 老板打开 dashboard 不选月份,看到品牌开业至今的累计营收 | 月下拉首项"全部",KPI 显示 SUM,vs 箭头隐藏 |
| 2 | 老板切到具体门店,不选月份,看到该门店开业至今的累计营收 | store 切换后,KPI 跟着收窄到该门店 |
| 3 | 用户想看某月数据,从"全部"切回具体月份 → 行为与改造前完全一致 | 月下拉列表、URL 参数、KPI 数字、趋势图全部保持原样 |
| 4 | 全量模式下点趋势图柱子和月模式一致能切 KPI | activeTrend / onClick 不变 |

## 3. 架构与数据流

```
Browser (Dashboard page)
  PeriodSelector (月/季/年 + "全部")     store <select>
        │                                   │
        └─────────────┬─────────────────────┘
                      ▼
       /api/financial/{overview,kpi-trend,
         income-metrics,payment-metrics,
         qimai-revenue}?brand&span&period=&store=
                      │
                      ▼
       parsePeriod(period, span) → PeriodRange
         ├── period === '' → { isAllTime: true }
         └── period 合法  → { isAllTime: false, start, end }
                      │
                      ▼
       仓库函数 getFinancialOverview(dm, ods, period, span, store)
         └── period === '' → 不拼 BETWEEN,只拼 store
```

## 4. 数据契约

### 4.1 URL 参数

| 参数 | 取值 | 含义 |
|---|---|---|
| `brand` | `gelatomiiix` / `bonjur` / `tamkoko` | 必填 |
| `span` | `month` / `quarter` / `year` | 必填 |
| `period` | `''` 或 `2026-06` / `2026-Q2` / `2026` | 空字符串 = 全部 |
| `store` | `all` 或 `<store_code>` | 已有语义,不变 |

### 4.2 响应字段

**不变**。所有 5 个 API 在全量模式下复用现有响应结构:

- `overview`:revenue / grossMarginRate / netProfitRate / operatingCashflow / cashBalance / beginningBalance / storeCount / revenuePerStore / cashRunway / qimaiNetRevenue / qimaiGrossRevenue / grossMarginRateQimaiNet / grossMarginRateQimaiGross / ignoreCount / vsPrevPeriod / expenses
- `kpi-trend`:monthly 数组(全量时不限 12 个,所有月返回)/ current / prev
- `income-metrics` / `payment-metrics`:monthly_trend 全量时全展开
- `qimai-revenue`:bank_revenue / qimai_revenue(全量时 = 当前月,与月模式相同)

### 4.3 全量模式下的字段语义

| 字段 | 全量值 |
|---|---|
| `revenue / expenses / operatingCashflow` | 全量 SUM |
| `grossMarginRate / netProfitRate` | 全量加权平均(分子分母 SUM 后相除)|
| `cashBalance` | 最后一条余额(与月模式相同)|
| `beginningBalance` | null(无期初概念)|
| `storeCount` | 当前 enabled=true 门店数 |
| `revenuePerStore` | revenue / storeCount |
| `qimaiNetRevenue / qimaiGrossRevenue` | 全量 SUM |
| `vsPrevPeriod.*` | 全部为 0(无对比期) |
| `kpi-trend.monthly[*]` | 包含品牌或门店的所有月份 |

## 5. 改动清单

### 5.1 前端

#### `ui/src/app/u/dashboard/page.tsx`

**PeriodSelector 组件** ([page.tsx:103-119](ui/src/app/u/dashboard/page.tsx#L103))
- 删除硬编码月份/季度/年份列表
- 用 `useMemo` + 当前日期动态生成:
  - 月:本月 + 前 17 个月(共 18 个)
  - 季:本季度 + 前 8 个季度(共 9 个)
  - 年:本年 + 前 3 年(共 4 个)
- 在三档下拉的首项各加 `<option value="">全部</option>`
- 选项 label 与现状一致(`2026-06` / `2026-Q2` / `2026`)

**DashboardPage 主体** ([page.tsx:416-619](ui/src/app/u/dashboard/page.tsx#L416))
- **删除** auto-select 最近月的 useEffect(`page.tsx:426-437`)。`period` 默认为空,直接使用。
- `period=''` 时,fetch URL 不带 `period=` 参数(让浏览器自然省略,避免空字符串进 wire)
- vsPrev 各字段在 `vsPrev === 0` 时不渲染箭头(现状代码已是 `vs && good`,改为 `vs && vsPrev !== 0`)
- 银行入账率卡片:现状 `store !== 'all'` 才显示;改为 **始终显示**,分子分母全量 SUM(由后端 `/api/financial/qimai-revenue?store=all` 提供)
- 期初余额小字:`beginningBalance > 0` 改为 `beginningBalance != null && beginningBalance > 0`
- 趋势图 x 轴 label:`d.month.slice(5)` 改为按 period 是否为空自适应 —— 空时显示完整 `YYYY-MM` 或隔月显示 `MM`
- 趋势图标题:全量时显示"全部历史趋势",否则显示原 span 名

### 5.2 后端

#### `ui/src/app/api/financial/period-utils.ts`

```ts
export type PeriodRange =
  | { isAllTime: true }
  | { isAllTime: false; start: string; end: string };

export function parsePeriod(period: string, span: string): PeriodRange | null {
  if (period === '' || period == null) return { isAllTime: true };
  // 现有 month/quarter/year 三段逻辑保留,包成 { isAllTime:false, start, end }
}
```

返回类型从 `[string, string] | null` 改为 `PeriodRange | null`。下游 5 个 route 都用 `range.start` / `range.end`,全量时只判 `range.isAllTime`。

#### `ui/src/lib/repositories/financial-repository.ts`

5 个仓库函数各加一行短路:

- `getFinancialOverview`
- `getKpiRate`
- `getOperatingExpenses`
- `getBeginningBalance`
- `getActiveStoreCount`

每个函数内部已有的 `WHERE biz_date BETWEEN $a AND $b` 片段加 `if (period !== '') { /* between */ } else { /* skip */ }`。

#### 5 个 API route

**通用模式**

```ts
const periodRaw = searchParams.get('period') || '';
const range = parsePeriod(periodRaw, span);
if (!range) return 400;  // 非法 period 仍报错,只是空串不再误报
const isAllTime = range.isAllTime;
```

**`/api/financial/overview`** ([route.ts:31-195](ui/src/app/api/financial/overview/route.ts#L31))
- `getPrevPeriod` 在 `period === ''` 时返回空字符串
- `prevPeriodStr === ''` 时,跳过 `vsPrevPeriod` 整段计算,响应中 vsPrevPeriod 字段全为 0

**`/api/financial/kpi-trend`**
- 月度列表生成逻辑:现状用 `getPrevPeriod` 算 12 个连续月;全量时改为不限月数,直接返回所有月
- `current / prev` 字段全量时为 null

**`/api/financial/income-metrics`**
- `monthly_trend` 全量时不限 12 个,返回所有月

**`/api/financial/payment-metrics`**
- 同 income-metrics

**`/api/financial/qimai-revenue`**
- 不依赖 period(只算当前月),**保持现状**,全量 = 当前月口径

## 6. 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| 仓库函数改 1 行影响其他调用方 | 低 | 现有 5 个 route 全是 period 字符串控制,空串原本就是"无",只是从未传过;加 Vitest 单测 |
| 月下拉硬编码导致当前月选不到 | 中(已发生)| 改动态生成 + 单测覆盖 |
| 全量趋势图柱子过多(>30)| 低 | 弹性布局,30 根以内无问题 |
| `parsePeriod` 改造影响其他 API | 低 | `grep` 验证只被 5 个 financial route 引用 |
| vsPrev=0 与"真无变化"混淆 | 中 | 可接受,本来少见 |

**回滚**:本次改动集中在 4 个文件,`git revert` 单 PR。

## 7. 测试与验收

### 7.1 自动化

**Vitest** (`ui/` 加测试文件):

- `__tests__/period-utils.test.ts`:5-6 个 case
  - `parsePeriod('', 'month')` → `{isAllTime:true}`
  - `parsePeriod('2026-06', 'month')` → `{isAllTime:false, start:'2026-06-01', end:'2026-07-01'}`
  - `parsePeriod('2026-Q2', 'quarter')` → `{isAllTime:false, ...}`
  - `parsePeriod('bad', 'month')` → null
  - `parsePeriod('', 'invalid')` → null

- `__tests__/PeriodSelector.test.tsx`:
  - 三档下拉首项 value=''
  - 切到"全部"触发 onChange('')
  - 月下拉包含当前月(用 `vi.useFakeTimers` 固定 2026-07-19)

- `__tests__/financial-overview.test.ts`(可选):
  - mock pool,验证 `period=''` 调用仓库时参数是空串

**Playwright E2E** (`ui/tests/e2e/dashboard.spec.ts`):

- 访问 `/u/dashboard`,月下拉选"全部",验证:
  - KPI 数字 = 全量 SUM(用 fixture 注入)
  - vs 箭头不渲染(`page.locator('text=↑').count() === 0`)
  - 银行入账率卡片可见(不限 store)

- 切门店后 KPI 数字变化(店均营收不同)
- 切回具体月份 → 回归检查 vs 箭头重新出现

### 7.2 手工验收

- [ ] 三品牌(tamkoko / gelatomiiix / bonjur)各走一遍
- [ ] tamkoko 单门店 hz_fuyang 全量 vs gelatomiiix 单门店 sh_sc 全量 数字直观合理
- [ ] 趋势图全量模式 x 轴 label 不重叠
- [ ] 期初余额小字在全量时不显示
- [ ] 自动选最近月不再发生(打开页 = period='')

### 7.3 回归保护

- 现有 5 个 API 在 `period` 非空时行为**完全不变**,用现有 integration 验证
- `/api/financial/qimai-revenue` 无 period 维度,无回归
- 其他页面(`/u/income` 等)不传 `period=''`,无回归

## 8. 文档更新

- `docs/qmaireport/financial-page-structure.md` §3 "经营看板":加一段说明全量模式行为
- `docs/qmaireport/financial-data-sources.md`:加一行,说明 API 接受 `period=''` 作为 sentinel
- 不改 README

## 9. 不在本次范围

- URL search param 同步 period/span/store
- "本年累计" / "近 12 月" / 自定义区间
- 趋势图缩放 / 隔 label 精细化
- 其他页面(`/u/income` `/u/payment` `/u/sales`)的全量模式
- MCP 工具的全量入口