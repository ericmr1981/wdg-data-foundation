# Dashboard 全量模式实施计划(v2 — `period='all'` wire 格式)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/u/dashboard` 加"全部月份"入口,展示品牌/门店全生命周期累计;金额型 KPI 累加,比率型加权平均;响应字段不变。

**Architecture:** 通过 `period='all'` 作为 wire sentinel(与仓库 `getIncomeMetrics` / `getPaymentMetrics` 已用格式一致);`parsePeriod` 不动;5 个 financial route 加 `isAll = period === 'all'` 短路;仓库函数 `getFinancialOverview` / `getKpiRate` / `getOperatingExpenses` / `getBeginningBalance` / `getActiveStoreCount` 各加 1 行 `isAll` 短路(用 `$N::date` 参数化 SQL,与现有 `income-metrics` 仓库风格一致);前端 PeriodSelector 月/季/年下拉首项加"全部"(value=`'all'`),删除 dashboard auto-select 最近月逻辑。

**Tech Stack:** Next.js 14 (App Router) + React 18 + TypeScript + TailwindCSS + pg + Playwright

**Spec:** `docs/superpowers/specs/2026-07-19-dashboard-alltime-design.md`

**Key existing code references (read these before editing):**
- `ui/src/app/api/financial/income-metrics/route.ts:30,53-69` — reference pattern for `isAll`
- `ui/src/lib/repositories/financial-repository.ts:313-340` — `getIncomeMetrics` repo function reference pattern
- `ui/src/app/api/financial/period-utils.ts` — DO NOT MODIFY (existing helper)
- `ui/src/lib/repositories/financial-utils.ts` — has `buildPeriodBoundaries` (use this in repo)

## Global Constraints

- **Wire format**:`period='all'` 字符串(不是空串),与 `income-metrics` 现状一致
- **响应字段不增不减**,前端靠 `vsPrev===0` 隐藏箭头
- **SQL 参数化**:所有日期过滤用 `$N::date` 参数,**禁止字符串插值**(遵循 CLAUDE.md "Parameterized queries only")
- 范围:仅 `/u/dashboard` 页;其他页面零改动
- 现有 `useBrand()` 上下文的 brand 选择与 `store` 状态保留
- 测试方式:Playwright e2e(`WDG_ADMIN_PASS` 凭据由用户在 dispatch 时提供)
- Commit 频率:每完成 1 个 task 立即 commit;commit 信息遵循 `feat:` / `fix:` / `test:` / `docs:` 前缀
- **不修改 `period-utils.ts` / `financial-utils.ts`**(现有 helper 已够用)

---

## Task 1: 仓库函数加 `isAll` 短路(5 个函数)

**Files:**
- Modify: `ui/src/lib/repositories/financial-repository.ts`

**Interfaces:**
- Consumes: 5 个仓库函数签名不变,继续接受 `period: string`
- Produces: `period === 'all'` 时不拼日期过滤;否则行为完全不变

**参考实现(对照 [financial-repository.ts:313-340](ui/src/lib/repositories/financial-repository.ts#L313) `getIncomeMetrics` 的模式)**

- [ ] **Step 1: 读现状**

```bash
cd ui && grep -nE "export async function (getFinancialOverview|getKpiRate|getOperatingExpenses|getBeginningBalance|getActiveStoreCount)" src/lib/repositories/financial-repository.ts
```

Expected: 看到 5 个函数位置。

- [ ] **Step 2: 给 `getFinancialOverview` 加 isAll 短路**

定位 `getFinancialOverview`([financial-repository.ts:49](ui/src/lib/repositories/financial-repository.ts#L49) 附近)。它在函数体内拼 `period >= to_char($1::date, 'YYYY-MM') AND period < to_char($2::date, 'YYYY-MM')`(参考 [line 86-87](ui/src/lib/repositories/financial-repository.ts#L86))。

**改造原则**:
1. 在函数最开头加 `const isAll = period === 'all';`
2. 把 `const boundaries = buildPeriodBoundaries(period, span);` 改为 `const boundaries = isAll ? null : buildPeriodBoundaries(period, span);`
3. 把 dateClause 拼接改为条件化:`if (!isAll && boundaries) { ... }`(全量时 dateClause 保持空字符串 '')
4. 全量时如果 boundaries 为 null,**不要 return**;继续走 SQL(dateClause 为空即可)

具体示例(参考 `getIncomeMetrics` 的 `isAll` 模式):
```ts
const isAll = period === 'all';
const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
if (!isAll && !boundaries) return { /* empty shape */ };

const params: (string | number)[] = [];
let dateClause = '';

if (!isAll && boundaries) {
  dateClause = `AND period >= to_char($1::date, 'YYYY-MM') AND period < to_char($2::date, 'YYYY-MM')`;
  params.push(boundaries.start, boundaries.end);
}
if (store !== 'all') {
  dateClause += ` AND t.store_code = $${params.length + 1}`;
  params.push(store);
}

// 现有 SQL 不变,只是 dateClause 是条件化的
```

- [ ] **Step 3: 给 `getKpiRate` 加 isAll 短路**

定位 `getKpiRate`([financial-repository.ts:214](ui/src/lib/repositories/financial-repository.ts#L214) 附近)。同 Step 2 模式。

- [ ] **Step 4: 给 `getOperatingExpenses` 加 isAll 短路**

定位 `getOperatingExpenses`([financial-repository.ts:231](ui/src/lib/repositories/financial-repository.ts#L231) 附近)。同 Step 2 模式。

- [ ] **Step 5: 给 `getBeginningBalance` 加 isAll 短路**

定位 `getBeginningBalance`([financial-repository.ts:181](ui/src/lib/repositories/financial-repository.ts#L181) 附近)。**全量模式下"期初余额"无定义**,全量时函数返回 `[]`,route 层判断后展示 null。

- [ ] **Step 6: 给 `getActiveStoreCount` 加 isAll 短路**

定位 `getActiveStoreCount`([financial-repository.ts:198](ui/src/lib/repositories/financial-repository.ts#L198) 附近)。**全量时按当前 enabled=true 门店数**,不需要 date 过滤;加 isAll 短路。

- [ ] **Step 7: 检查 `getQimaiRevenue`(可能需要改)**

定位 `getQimaiRevenue`([financial-repository.ts:248](ui/src/lib/repositories/financial-repository.ts#L248) 附近),检查它是否已经处理 `period === 'all'`。

**关键**:spec §4.3 说"qimai-revenue 全量=当前月口径"。即累加到 CURRENT_DATE。

如果现状它用 `buildPeriodBoundaries` 处理 period 且没 isAll 短路,需要补:

```ts
const isAll = period === 'all';
const boundaries = isAll
  ? { start: '1900-01-01', end: 'CURRENT_DATE' }
  : buildPeriodBoundaries(period, span);
```

如果现状已经有 isAll 处理,跳过此步。

- [ ] **Step 8: 验证编译**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 没有新增 error(`overview`/`kpi-trend`/`qimai-revenue` route 还没改,可能短暂报 type mismatch — Task 2 一起修)。

- [ ] **Step 9: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/lib/repositories/financial-repository.ts
git commit -m "feat(repo): getFinancialOverview/getKpiRate/getOperatingExpenses/getBeginningBalance/getActiveStoreCount 支持 period='all'"
```

---

## Task 2: 5 个 financial route 迁移到 `period='all'`

**Files:**
- Modify: `ui/src/app/api/financial/overview/route.ts`
- Modify: `ui/src/app/api/financial/kpi-trend/route.ts`
- Modify: `ui/src/app/api/financial/qimai-revenue/route.ts`
- (income-metrics / payment-metrics 已支持,不动)

**Interfaces:**
- Consumes: URL `?period=...&span=...&store=...`
- Produces: `period === 'all'` 时跳过日期 SQL,vsPrev 全为 0,monthly 数组全量展开

**参考实现(对照 [income-metrics/route.ts:30,53-69](ui/src/app/api/financial/income-metrics/route.ts#L30))**

- [ ] **Step 1: 修改 `overview/route.ts`**

定位 [overview/route.ts:31-46](ui/src/app/api/financial/overview/route.ts#L31):

```ts
// 现状
const period = searchParams.get('period') || '';
const span = searchParams.get('span') || 'month';
const store = searchParams.get('store') || 'all';
// ...
const boundaries = parsePeriod(period, span);
if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });

// 改为
const period = searchParams.get('period') || 'all';
const span = searchParams.get('span') || 'month';
const store = searchParams.get('store') || 'all';
// ...
const isAll = period === 'all';
const boundaries = isAll ? null : parsePeriod(period, span);
if (!isAll && !boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
```

继续:
- 把后续 `boundaries[0]` / `boundaries[1]` 改为 `isAll ? null : boundaries[0]` / `isAll ? null : boundaries[1]`
- `getPrevPeriod` 调用:[line 138](ui/src/app/api/financial/overview/route.ts#L138) `const prevPeriodStr = getPrevPeriod(period, span);` 改为 `const prevPeriodStr = isAll ? '' : getPrevPeriod(period, span);`(全量时无对比期)
- 仓库调用:`getFinancialOverview(dm, ods, period, span, store)` 等保持不变 — period 传 `'all'`,Task 1 已短路
- `getBeginningBalance` 全量时返回 `[]`,把 [line 116](ui/src/app/api/financial/overview/route.ts#L116) 的 `Number(beginBalanceRes[0]?.cash_balance || 0)` 改为 `isAll ? null : Number(beginBalanceRes[0]?.cash_balance || 0)`

- [ ] **Step 2: 修改 `kpi-trend/route.ts`**

定位 [kpi-trend/route.ts:20,26-28](ui/src/app/api/financial/kpi-trend/route.ts#L20):

```ts
// 现状
const period = searchParams.get('period') || '';
// ...
const boundaries = parsePeriod(period, span);
if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
const [startDate, endDate] = boundaries;

// 改为
const period = searchParams.get('period') || 'all';
// ...
const isAll = period === 'all';
const boundaries = isAll ? null : parsePeriod(period, span);
if (!isAll && !boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
const startDate = isAll ? null : boundaries![0];
const endDate = isAll ? null : boundaries![1];
```

定位 `current_month / prev_month` 字段([line 223-228](ui/src/app/api/financial/kpi-trend/route.ts#L223)):

```ts
// 改为
return NextResponse.json({
  success: true,
  data: {
    monthly,
    current_month: isAll ? null : { revenue: currentRevenue, expenses: currentExpenses },
    prev_month: isAll ? null : { revenue: prevRevenue, expenses: prevExpenses },
  },
});
```

定位 `prevPeriodStr` 计算([line 147-152](ui/src/app/api/financial/kpi-trend/route.ts#L147)):全量时 `prevPeriodStr = ''`,SQL 参数 push 跟着 isAll 短路 — 检查函数内所有 `params.push(startDate)` 是否需要 `if (!isAll)` 守卫。

- [ ] **Step 3: 修改 `qimai-revenue/route.ts`**

定位 [qimai-revenue/route.ts:18-23](ui/src/app/api/financial/qimai-revenue/route.ts#L18):

```ts
// 现状
const period = searchParams.get('period') || '';
const span = searchParams.get('span') || 'month';
const store = searchParams.get('store') || 'all';
// ...
const boundaries = parsePeriod(period, span);
if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });

// 改为
const period = searchParams.get('period') || 'all';
const span = searchParams.get('span') || 'month';
const store = searchParams.get('store') || 'all';
// ...
const isAll = period === 'all';
const boundaries = isAll ? null : parsePeriod(period, span);
if (!isAll && !boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
```

`getQimaiRevenue` 在 Task 1 已支持 `'all'`,直接传 period 即可。

- [ ] **Step 4: 验证编译**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -15
```
Expected: 没有 error。

- [ ] **Step 5: 起 dev server,手工 smoke**

```bash
cd ui && npm run dev &
sleep 8

# 回归:正常月份
curl -s 'http://localhost:4100/api/financial/overview?brand=gelatomiiix&period=2026-06&span=month&store=all' | head -c 200
echo

# 全量
curl -s 'http://localhost:4100/api/financial/overview?brand=gelatomiiix&period=all&span=month&store=all' | head -c 200
echo

# kpi-trend 全量
curl -s 'http://localhost:4100/api/financial/kpi-trend?brand=gelatomiiix&period=all&span=month&store=all' | head -c 300
echo
```

Expected:
- 正常月份返回 200,数据正常
- 全量返回 200,数据是品牌全量(金额比月份大很多)
- kpi-trend 全量 monthly 数组长度 > 12,`current_month` / `prev_month` 是 null

如果 401(未登录),说明 auth 拦截了,正常。

- [ ] **Step 6: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/app/api/financial/
git commit -m "feat(api): overview/kpi-trend/qimai-revenue 支持 period='all' 全量 sentinel"
```

---

## Task 3: 前端 PeriodSelector 改造(动态化 + 全部选项)

**Files:**
- Modify: `ui/src/app/u/dashboard/page.tsx`

**Interfaces:**
- Consumes: `span` / `period` state
- Produces: 月/季/年下拉首项 `<option value="all">全部</option>`,列表动态生成

- [ ] **Step 1: 替换 PeriodSelector 组件**

打开 `ui/src/app/u/dashboard/page.tsx`,定位 [line 103-119](ui/src/app/u/dashboard/page.tsx#L103) 的 PeriodSelector 函数,完整替换为:

```tsx
function PeriodSelector({ span, period, setSpan, setPeriod }: { span: SpanId; period: string; setSpan: (v: SpanId) => void; setPeriod: (v: string) => void }) {
  const options = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    if (span === 'month') {
      const arr: string[] = ['all'];
      for (let i = 0; i < 18; i++) {
        const d = new Date(y, m - i, 1);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        arr.push(`${d.getFullYear()}-${mm}`);
      }
      return arr;
    }
    if (span === 'quarter') {
      const curQ = Math.floor(m / 3) + 1;
      const arr: string[] = ['all'];
      for (let i = 0; i < 9; i++) {
        const qOffset = i;
        const yearOff = Math.floor((curQ - 1 - qOffset) / 4);
        const qNum = ((curQ - 1 - qOffset) % 4 + 4) % 4 + 1;
        const qy = y - yearOff;
        arr.push(`${qy}-Q${qNum}`);
      }
      return arr;
    }
    const arr: string[] = ['all'];
    for (let i = 0; i < 4; i++) {
      arr.push(String(y - i));
    }
    return arr;
  }, [span]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select value={span} onChange={e => setSpan(e.target.value as SpanId)} className="border rounded px-2 py-1 text-sm bg-white">
        <option value="month">月度</option>
        <option value="quarter">季度</option>
        <option value="year">年度</option>
      </select>
      <select value={period} onChange={e => setPeriod(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
        {options.map(o => (
          <option key={o} value={o}>{o === 'all' ? '全部' : o}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: 改 `period` 默认值为 `'all'`**

定位 [page.tsx:419](ui/src/app/u/dashboard/page.tsx#L419):

```tsx
// 现状
const [period, setPeriod] = useState<string>('');

// 改为
const [period, setPeriod] = useState<string>('all');
```

- [ ] **Step 3: 验证编译**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 无 error。

- [ ] **Step 4: 起 dev server,浏览器手工 smoke**

```bash
cd ui && npm run dev &
sleep 8
# 打开 http://localhost:4100/u/dashboard
```

Expected:
- 月下拉首项为"全部"
- 月列表包含 2026-07(当前月)
- 默认 `period='all'`,KPI 显示品牌全量

- [ ] **Step 5: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/app/u/dashboard/page.tsx
git commit -m "feat(dashboard): PeriodSelector 动态化 + 月/季/年下拉首项加 '全部' (period='all')"
```

---

## Task 4: 前端 DashboardPage 适配(删除 auto-select + 全量 UI 适配)

**Files:**
- Modify: `ui/src/app/u/dashboard/page.tsx`

**Interfaces:**
- Consumes: 已有 overview / kpiTrend / bankRevenue / qimaiRevenue state
- Produces: 全量模式下 vsPrev 箭头隐藏、银行入账率始终显示、期初小字按 null 隐藏、趋势图 x 轴自适应

- [ ] **Step 1: 删除 auto-select 最近月 useEffect**

打开 `ui/src/app/u/dashboard/page.tsx`,删除 [line 426-437](ui/src/app/u/dashboard/page.tsx#L426) 整段 useEffect:

```tsx
// 整段删除
useEffect(() => {
  if (!brand) return;
  fetch(`/api/financial/kpi-trend?brand=${brand}&period=2026-06&span=month&store=all`)
    .then(r => r.json())
    .then(d => {
      if (d?.data?.monthly?.length) {
        const latest = d.data.monthly[d.data.monthly.length - 1].month;
        if (latest) setPeriod(latest);
      }
    })
    .catch(() => {});
}, [brand]);
```

`period` 默认就是 `'all'`,不需要推断。

- [ ] **Step 2: 改 vsPrev 箭头渲染逻辑**

定位 [page.tsx:146](ui/src/app/u/dashboard/page.tsx#L146) 的 `KpiCard`:

```tsx
// 现状
const vs = vsPrev !== undefined;
const good = vs ? (invert ? vsPrev <= 0 : vsPrev >= 0) : true;

// 改为
const vs = vsPrev !== undefined && vsPrev !== 0;
const good = vs ? (invert ? vsPrev <= 0 : vsPrev >= 0) : true;
```

- [ ] **Step 3: 改银行入账率卡片(始终显示)**

定位 [page.tsx:558-575](ui/src/app/u/dashboard/page.tsx#L558),把条件渲染改为始终显示:

```tsx
// 现状
{store !== 'all' ? (
  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
    ...
  </div>
) : (
  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
    <div className="text-[11px] text-gray-500">银行入账率</div>
    <div className="text-lg font-bold text-gray-400">选择门店</div>
  </div>
)}

// 改为(始终紫色卡片)
<div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
  <div className="text-[11px] text-purple-600">银行入账率</div>
  <div className="text-lg font-bold text-purple-900">
    {entryRate !== null ? `${(entryRate * 100).toFixed(1)}%` : (qimaiRevenue === null ? '无企迈数据' : '加载中...')}
  </div>
  {bankRevenue !== null && qimaiRevenue !== null && (
    <div className="text-[10px] text-purple-500 mt-0.5 leading-tight">
      银行 ¥{bankRevenue.toLocaleString()}<br />企迈 ¥{qimaiRevenue.toLocaleString()}
    </div>
  )}
</div>
```

并删除 [line 475](ui/src/app/u/dashboard/page.tsx#L475) `showEntryRate` 的 store 条件:

```tsx
// 现状
const showEntryRate = store !== 'all' && bankRevenue !== null && qimaiRevenue !== null;

// 改为
const showEntryRate = bankRevenue !== null && qimaiRevenue !== null;
```

- [ ] **Step 4: 期初余额小字按 null 隐藏**

定位 [page.tsx:540-548](ui/src/app/u/dashboard/page.tsx#L540):

```tsx
// 现状
{overview.beginningBalance > 0 && (...)

// 改为
{(overview.beginningBalance ?? 0) > 0 && (...)}
```

- [ ] **Step 5: 趋势图 x 轴 label 自适应**

定位 [page.tsx:198](ui/src/app/u/dashboard/page.tsx#L198):

```tsx
// 现状
<div className="absolute text-[9px] text-gray-400" style={{ bottom: '-18px' }}>{d.month.slice(5)}</div>

// 改为
<div className="absolute text-[9px] text-gray-400" style={{ bottom: '-18px' }}>{d.month.slice(2)}</div>
```

(月模式显示 `26-06` 节省空间;若希望全量时显示完整 `2026-06`,改为 `{d.month}`)

- [ ] **Step 6: 趋势图标题全量时改文案**

定位 [page.tsx:183](ui/src/app/u/dashboard/page.tsx#L183):

```tsx
// 现状
<h3 className="text-sm font-semibold text-gray-700 mb-3">{TREND_LABELS[trendKey]}趋势</h3>

// 改为
<h3 className="text-sm font-semibold text-gray-700 mb-3">
  {TREND_LABELS[trendKey]}趋势{period === 'all' ? '(全部历史)' : ''}
</h3>
```

- [ ] **Step 7: 验证编译 + dev server**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
npm run dev &
sleep 8
# 浏览器 http://localhost:4100/u/dashboard
```

Expected:
- 默认进入页面 period='all',KPI 是全量累计(数字大)
- vs 箭头不显示
- 银行入账率紫色卡片显示
- 期初小字不显示
- 趋势图标题 "(全部历史)"
- 切回具体月份 → 数字变小,vs 箭头出现
- 切门店 → 数字进一步变化

- [ ] **Step 8: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/app/u/dashboard/page.tsx
git commit -m "feat(dashboard): 适配全量模式(去 auto-select + vs 箭头 + 入账率 + 期初 + 趋势)"
```

---

## Task 5: Playwright E2E(全量 vs 月份 回归)

**Files:**
- Create: `ui/tests/e2e/dashboard-alltime.spec.ts`

**Interfaces:**
- Consumes: dev server on :4100 + `WDG_ADMIN_PASS` env
- Produces: 验证全量 / 月份两种 mode 的 KPI 数字、vs 箭头、银行入账率卡片

- [ ] **Step 1: 创建 e2e 文件**

```ts
// ui/tests/e2e/dashboard-alltime.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Dashboard 全量模式', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/u/dashboard');
    await expect(page.getByRole('heading', { name: '经营看板' })).toBeVisible({ timeout: 15_000 });
  });

  test('全量模式默认进入:vs 箭头不显示,银行入账率始终显示', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const periodSelect = page.locator('select').nth(1);
    expect(await periodSelect.inputValue()).toBe('all');

    const arrows = page.locator('text=/[↑↓]/');
    expect(await arrows.count()).toBe(0);

    await expect(page.getByText('银行入账率')).toBeVisible();
    await expect(page.getByText('选择门店')).toHaveCount(0);
  });

  test('切到具体月份:数据变化', async ({ page }) => {
    const periodSelect = page.locator('select').nth(1);
    const allOptions = await periodSelect.locator('option').all();
    for (const opt of allOptions) {
      const v = await opt.getAttribute('value');
      if (v && v !== 'all') {
        await periodSelect.selectOption({ value: v });
        break;
      }
    }
    await page.waitForLoadState('networkidle');

    expect(await periodSelect.inputValue()).not.toBe('all');

    await expect(page.locator('text=/¥\\d/').first()).toBeVisible();
  });

  test('门店切换:数字跟随变化', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const firstKpi = await page.locator('text=/¥[\\d,]+/').first().textContent();

    const storeSelect = page.locator('select').nth(2);
    const storeOptions = await storeSelect.locator('option').all();
    for (const opt of storeOptions) {
      const v = await opt.getAttribute('value');
      if (v && v !== 'all') {
        await storeSelect.selectOption({ value: v });
        break;
      }
    }
    await page.waitForLoadState('networkidle');

    const secondKpi = await page.locator('text=/¥[\\d,]+/').first().textContent();
    expect(secondKpi).not.toBe(firstKpi);
  });
});
```

- [ ] **Step 2: 设置测试凭据并运行**

```bash
cd ui
grep -E "WDG_ADMIN_PASS|WDG_ADMIN_USER" .env.local 2>&1 | head
```

跑测试:

```bash
cd ui
WDG_ADMIN_PASS='<从 .env.local 取>' \
WDG_ADMIN_USER='admin' \
npx playwright test tests/e2e/dashboard-alltime.spec.ts --reporter=list 2>&1 | tail -30
```

Expected: 3 tests passed。

- [ ] **Step 3: 跑回归 smoke**

```bash
cd ui
WDG_ADMIN_PASS='<同>' \
WDG_ADMIN_USER='admin' \
npx playwright test browser-smoke.spec.ts --reporter=list 2>&1 | tail -15
```

Expected: 通过(回归保护)。

- [ ] **Step 4: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/tests/e2e/dashboard-alltime.spec.ts
git commit -m "test(e2e): dashboard 全量模式 3 个 case + 回归 smoke"
```

---

## Task 6: 文档更新(qmaireport)

**Files:**
- Modify: `docs/qmaireport/financial-page-structure.md`
- Modify: `docs/qmaireport/financial-data-sources.md`

- [ ] **Step 1: 在 financial-page-structure.md §3 加段**

打开 `docs/qmaireport/financial-page-structure.md`,定位 §3 "经营看板"。在控制栏描述后加:

```markdown
### 3.1 全量模式

PeriodSelector 月/季/年下拉首项为"全部",选中后 `period='all'`。语义:
- 金额型 KPI(营收 / 费用 / 经营现金流)= 品牌或门店全量 SUM
- 比率型 KPI(毛利率 / 净利率)= 全量加权平均
- 趋势图 = 全部历史月柱图
- vs 同期(↑↓)= 隐藏(全量无对比期)
- 银行入账率 = 始终显示,分子分母全量 SUM

门店维度不变:`store='all'` = 品牌汇总,`store='<code>'` = 该门店。
```

- [ ] **Step 2: 在 financial-data-sources.md 加一行**

打开 `docs/qmaireport/financial-data-sources.md`,在 financial API 描述末尾加:

```markdown
> 5 个 financial API 接受 `period='all'` 作为"全量" sentinel,等同于不限日期范围,返回品牌或门店的全部历史聚合。`income-metrics` / `payment-metrics` 已长期支持;`overview` / `kpi-trend` / `qimai-revenue` 自 2026-07-19 起支持。
```

- [ ] **Step 3: 验证**

```bash
grep -A 1 "全量模式" docs/qmaireport/financial-page-structure.md | head -10
grep "period='all'" docs/qmaireport/financial-data-sources.md
```

Expected: 两段都搜得到。

- [ ] **Step 4: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add docs/qmaireport/
git commit -m "docs(qmaireport): dashboard 全量模式说明 + API period='all' sentinel"
```

---

## Self-Review

### 1. Spec coverage
- §2 用户故事 → Task 3 (PeriodSelector) + Task 4 (UI 适配) ✅
- §3 架构 → Task 1 (仓库) + Task 2 (route) ✅
- §4.1 URL 参数 → Task 2 (`period='all'`) ✅
- §4.2 响应字段不变 → Task 2 保持 ✅
- §4.3 全量字段语义 → Task 2 (current/prev=null) + Task 4 (UI 适配) ✅
- §5.1 前端 PeriodSelector → Task 3 ✅
- §5.1 前端 DashboardPage → Task 4 ✅
- §5.2 仓库函数 → Task 1 ✅
- §5.2 5 个 route → Task 2 ✅
- §7 测试 → Task 5 (e2e) ✅
- §8 文档 → Task 6 ✅

### 2. Placeholder scan
无 "TBD" / "TODO" / "fill in"。`<从 .env.local 取>` 在 Task 5 Step 2 — 明确指向环境文件,不是占位符。

### 3. Type consistency
- `period='all'` 字符串 sentinel 全文一致(对照 repo 现有 `income-metrics`)
- `isAll = period === 'all'` 模式贯穿 Task 1 / 2
- 仓库函数签名未变
- SQL 全部用 `$N::date` 参数化,无字符串插值

### 4. Plan changes from v1
- 删除 Task 1 (`parsePeriod` 改造):无需改 period-utils,仓库已有 buildPeriodBoundaries
- 合并:Task 1 (仓库短路) + Task 2 (route 迁移)
- 任务数从 7 → 6
- 所有 `period === ''` 改为 `period === 'all'`
- 删除 `PeriodRange` sentinel 类型(不需要)
- 修复 v1 的 SQL 字符串插值问题(违反 CLAUDE.md 参数化规则)
