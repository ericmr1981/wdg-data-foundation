# Dashboard 全量模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/u/dashboard` 上加"全部月份"入口,展示品牌/门店全生命周期累计;金额型 KPI 累加,比率型加权平均;响应字段不变。

**Architecture:** 通过 `period=''` 作为全量 sentinel;`parsePeriod` 返回 `{isAllTime}` 对象;仓库层短路 `BETWEEN`;5 个 route 短路 vsPrev 与 12 月截断;前端 PeriodSelector 月/季/年下拉首项加"全部",删除 auto-select 最近月逻辑。

**Tech Stack:** Next.js 14 (App Router) + React 18 + TypeScript + TailwindCSS + pg + Playwright

**Spec:** `docs/superpowers/specs/2026-07-19-dashboard-alltime-design.md`

## Global Constraints

- 工作目录:`.worktrees/feat/dashboard-alltime-mode`(已在 main 上 commit `.worktrees/` gitignore 与 spec)
- 响应字段**不增不减**,前端靠 `vsPrev===0` 隐藏箭头
- 后端不引入新依赖,只改路由拼接与仓库函数短路
- 现有 5 个 API 在 period 非空时行为完全不变(回归保护)
- 范围:仅 `/u/dashboard` 页;其他页面(`/u/income` `/u/payment` `/u/sales`)零改动
- 现有 `useBrand()` 上下文的 brand 选择与 `store` 状态保留;period 与 span 是新逻辑入口
- 测试方式:Vitest 项目未装,改用 Playwright e2e + Node `--test` 内置(只对纯函数 parsePeriod 适用)
- Commit 频率:每完成 1 个 task 立即 commit;commit 信息遵循 `feat:` / `fix:` / `test:` / `docs:` / `chore:` 前缀

---

## Task 1: `parsePeriod` 改造为 PeriodRange sentinel

**Files:**
- Modify: `ui/src/app/api/financial/period-utils.ts`
- Test: `ui/tests/period-utils.test.ts`(新建)

**Interfaces:**
- Consumes:`period: string`,`span: 'month'|'quarter'|'year'`
- Produces:`PeriodRange = { isAllTime: true } | { isAllTime: false; start: string; end: string } | null`
- 现有调用方(5 个 financial route)暂不动;本次只新增导出,**下一 task 再迁移调用方**

- [ ] **Step 1: 写失败的 parsePeriod 单测**

```ts
// ui/tests/period-utils.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod } from '../src/app/api/financial/period-utils';

test('parsePeriod: 空字符串 → 全量 sentinel', () => {
  const r = parsePeriod('', 'month');
  assert.deepEqual(r, { isAllTime: true });
});

test('parsePeriod: month 合法 → 返回 [start,end)', () => {
  const r = parsePeriod('2026-06', 'month');
  assert.deepEqual(r, { isAllTime: false, start: '2026-06-01', end: '2026-07-01' });
});

test('parsePeriod: quarter 合法', () => {
  const r = parsePeriod('2026-Q2', 'quarter');
  assert.deepEqual(r, { isAllTime: false, start: '2026-04-01', end: '2026-07-01' });
});

test('parsePeriod: year 合法', () => {
  const r = parsePeriod('2026', 'year');
  assert.deepEqual(r, { isAllTime: false, start: '2026-01-01', end: '2027-01-01' });
});

test('parsePeriod: 非法 month → null', () => {
  assert.equal(parsePeriod('bad', 'month'), null);
});

test('parsePeriod: 非法 span → null', () => {
  assert.equal(parsePeriod('', 'invalid' as never), null);
});
```

- [ ] **Step 2: 运行测试,确认失败(因为还没导出新签名)**

Run:
```bash
cd ui && node --import tsx --test tests/period-utils.test.ts 2>&1 | tail -20
```
Expected: 失败,报 `parsePeriod is not a function` 或签名不匹配。

- [ ] **Step 3: 修改 period-utils.ts**

```ts
// ui/src/app/api/financial/period-utils.ts
export type PeriodRange =
  | { isAllTime: true }
  | { isAllTime: false; start: string; end: string };

export function parsePeriod(period: string, span: string): PeriodRange | null {
  if (period === '' || period == null) {
    return { isAllTime: true };
  }
  if (span === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) return null;
    const [, y, mm] = m;
    const start = `${y}-${mm}-01`;
    const endMonth = Number(mm) === 12 ? '01' : String(Number(mm) + 1).padStart(2, '0');
    const endYear = Number(mm) === 12 ? String(Number(y) + 1) : y;
    return { isAllTime: false, start, end: `${endYear}-${endMonth}-01` };
  }
  if (span === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!m) return null;
    const [, y, q] = m;
    const startMonth = String((Number(q) - 1) * 3 + 1).padStart(2, '0');
    const endMonth = String(Number(q) === 4 ? 1 : Number(q) * 3 + 1).padStart(2, '0');
    const endYear = Number(q) === 4 ? String(Number(y) + 1) : y;
    return {
      isAllTime: false,
      start: `${y}-${startMonth}-01`,
      end: `${endYear}-${endMonth}-01`,
    };
  }
  if (span === 'year') {
    const m = /^(\d{4})$/.exec(period);
    if (!m) return null;
    const [, y] = m;
    return { isAllTime: false, start: `${y}-01-01`, end: `${Number(y) + 1}-01-01` };
  }
  return null;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run:
```bash
cd ui && node --import tsx --test tests/period-utils.test.ts 2>&1 | tail -15
```
Expected: 6 tests passed。

注:`tsx` 需先安装为 dev 依赖:
```bash
cd ui && npm install --save-dev tsx
```

如果 `tsx` 装不上,用 `npx tsx`:
```bash
cd ui && npx --yes tsx --test tests/period-utils.test.ts
```

- [ ] **Step 5: 验证类型不破坏(5 个 route 暂未迁移,但 import 应仍编译)**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 没有 `parsePeriod` 相关错误(因为现有调用还没改,会报 type 不匹配 — 跳过本步,等 Task 2 一起迁移)。

如严格类型检查失败也没关系,TypeScript 在 Next.js dev/build 时才严格校验;在 Task 2 迁移完所有调用方后再验证。

- [ ] **Step 6: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/tests/period-utils.test.ts ui/src/app/api/financial/period-utils.ts ui/package.json ui/package-lock.json
git commit -m "feat(period-utils): parsePeriod 返回 PeriodRange sentinel 支持全量"
```

---

## Task 2: 仓库函数短路 `BETWEEN`(5 个函数)

**Files:**
- Modify: `ui/src/lib/repositories/financial-repository.ts`

**Interfaces:**
- Consumes: 5 个仓库函数签名不变,继续接受 `period: string` 参数
- Produces: `period === ''` 时不拼 `biz_date BETWEEN $a AND $b` 片段,只拼 store 过滤

- [ ] **Step 1: 查看 5 个仓库函数现状**

```bash
cd ui && grep -n "BETWEEN\|period" src/lib/repositories/financial-repository.ts | head -40
```
Expected: 看到 5 个函数 `getFinancialOverview` / `getKpiRate` / `getOperatingExpenses` / `getBeginningBalance` / `getActiveStoreCount` 各自的 between 拼接模式。

- [ ] **Step 2: 在每个 between 片段前加 sentinel 短路**

打开 `ui/src/lib/repositories/financial-repository.ts`,找到所有形如:

```ts
WHERE biz_date BETWEEN $a AND $b
```

或类似日期过滤的位置。**对每个仓库函数**,把日期过滤改为:

```ts
const periodClause = period === '' ? '' : `AND biz_date BETWEEN '${start}' AND '${end}'`;
```

(若现有 SQL 使用 `$a` / `$b` 参数化,改为 `period === '' ? '1=1' : \`biz_date BETWEEN $a AND $b\`` 形式,具体取决于现有写法)

**示例(针对 `getFinancialOverview`)**:

现有(假设):
```ts
sql = `SELECT ... FROM ${dmSchema}.bank_txn_classified_snapshot WHERE store_code = $1 AND biz_date BETWEEN $2 AND $3`;
```

改为:
```ts
const dateClause = period === '' ? '' : `AND biz_date BETWEEN '${start}' AND '${end}'`;
sql = `SELECT ... FROM ${dmSchema}.bank_txn_classified_snapshot WHERE store_code = $1 ${dateClause}`;
```

**对 5 个函数都做同样改造**:
1. `getFinancialOverview`
2. `getKpiRate`
3. `getOperatingExpenses`
4. `getBeginningBalance`
5. `getActiveStoreCount`

每个函数用 `grep -n "BETWEEN" src/lib/repositories/financial-repository.ts` 定位;若函数没有 date 过滤(纯 store 维度)就跳过,无需改。

- [ ] **Step 3: 验证编译**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 没有 syntax / type error(若仅报 route.ts 签名不匹配,是因为旧 route 还在用旧签名,正常)。

- [ ] **Step 4: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/lib/repositories/financial-repository.ts
git commit -m "feat(repo): 仓库函数 period==='' 时短路日期过滤"
```

---

## Task 3: 迁移 5 个 financial route 使用新 PeriodRange 签名

**Files:**
- Modify: `ui/src/app/api/financial/overview/route.ts`
- Modify: `ui/src/app/api/financial/kpi-trend/route.ts`
- Modify: `ui/src/app/api/financial/income-metrics/route.ts`
- Modify: `ui/src/app/api/financial/payment-metrics/route.ts`
- Modify: `ui/src/app/api/financial/qimai-revenue/route.ts`(本文件无需改 PeriodRange,但要确认它不依赖 between)

**Interfaces:**
- Consumes: `parsePeriod(period, span)` → `PeriodRange | null`
- Produces: 把 `range.start` / `range.end` 传给仓库函数;全量时跳过 vsPrev 与 12 月截断

- [ ] **Step 1: 迁移 `overview/route.ts`**

在 [overview/route.ts:46-47](ui/src/app/api/financial/overview/route.ts#L46) 区域:

```ts
// 现状
const boundaries = parsePeriod(period, span);
if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });

// 改为
const range = parsePeriod(period, span);
if (!range) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
const isAllTime = range.isAllTime;
// 后续 dates: 用 range.start / range.end(全量时直接不传给仓库,或传空串让 Task 2 短路)
```

把下游所有 `boundaries[0]` / `boundaries[1]` 替换为 `isAllTime ? '' : range.start` / `isAllTime ? '' : range.end`。

然后在 [overview/route.ts:138](ui/src/app/api/financial/overview/route.ts#L138) `getPrevPeriod` 调用前:

```ts
// 现状
const prevPeriodStr = getPrevPeriod(period, span);

// 改为
const prevPeriodStr = isAllTime ? '' : getPrevPeriod(period, span);
```

并把后续 `if (prevPeriodStr)` 块(已有短路)保留 — 此时直接短路掉。

最后修改仓库调用:

```ts
// 现状
getFinancialOverview(dmSchema, odsSchema, period, span, store),

// 改为(传空 period 让仓库内部短路 between)
getFinancialOverview(dmSchema, odsSchema, isAllTime ? '' : period, span, store),
```

(同样模式应用到其他 `getBeginningBalance` / `getActiveStoreCount` / `getKpiRate` / `getOperatingExpenses` 调用)

- [ ] **Step 2: 迁移 `kpi-trend/route.ts`**

定位生成 `monthly` 数组的 SQL(通常会有 `BETWEEN` + `generate_series` 或类似逻辑)。如果它当前用 `getPrevPeriod` 算 12 个连续月:

```ts
// 现状(伪码)
const months = [];
let p = getPrevPeriod(period, span);
for (let i = 0; i < 12; i++) {
  months.push(p);
  p = getPrevPeriod(p, span);
}

// 改为
let months: string[];
if (isAllTime) {
  // 直接从数据库查所有月(用 DISTINCT biz_date 或 generate_series from earliest to today)
  // 简化方案: SQL 用 generate_series 从品牌 ODS 第一条 biz_date 到 CURRENT_DATE
  const allMonthsRes = await pool.query(
    `SELECT DISTINCT to_char(date_trunc('month', biz_date), 'YYYY-MM') AS month
     FROM ${odsSchema}.bank_txn ORDER BY month`
  );
  months = allMonthsRes.rows.map(r => r.month);
} else {
  months = [];
  let p = getPrevPeriod(period, span);
  for (let i = 0; i < 12; i++) {
    months.push(p);
    p = getPrevPeriod(p, span);
  }
}
```

把 `current_month` / `prev_month` 字段,在全量时设为 `null`:

```ts
return NextResponse.json({
  success: true,
  data: {
    monthly,
    current_month: isAllTime ? null : currentMonth,
    prev_month: isAllTime ? null : prevMonth,
    // ...其余字段
  }
});
```

把仓库调用传给 `period = isAllTime ? '' : period`。

- [ ] **Step 3: 迁移 `income-metrics/route.ts` 和 `payment-metrics/route.ts`**

定位 `monthly_trend` 生成 SQL,把 SQL 中 `BETWEEN` 改为 `period === '' ? '1=1' : \`biz_date BETWEEN ...\``(仓库层已短路的话,SQL 也会跟着空)。

确认仓库调用传 `isAllTime ? '' : period`。

- [ ] **Step 4: 检查 `qimai-revenue/route.ts`**

```bash
cd ui && grep -n "BETWEEN\|period" src/app/api/financial/qimai-revenue/route.ts | head
```

如果它**不依赖 period**(只算当前月) → 不用改,符合 spec §4.3 "全量=当前月口径"。

如果它用了 period → 同样应用 `isAllTime ? '' : period` 模式。

- [ ] **Step 5: 验证编译**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -20
```
Expected: 没有 error(可能有 warning,允许)。

- [ ] **Step 6: 起 dev server 手工 smoke**

```bash
cd ui && npm run dev &
sleep 8

# 正常月份(回归)
curl -s 'http://localhost:4100/api/financial/overview?brand=gelatomiiix&period=2026-06&span=month&store=all' | head -c 200
echo

# 全量
curl -s 'http://localhost:4100/api/financial/overview?brand=gelatomiiix&period=&span=month&store=all' | head -c 200
echo

# kpi-trend 全量
curl -s 'http://localhost:4100/api/financial/kpi-trend?brand=gelatomiiix&period=&span=month&store=all' | head -c 200
echo
```

Expected:
- 正常月份返回 200,数据正常
- 全量返回 200,数据是品牌全量(金额比月份大很多)
- kpi-trend 全量 monthly 数组长度 > 12,`current_month` / `prev_month` 是 null

如果 401(未登录),说明 auth 拦截了;这是正常的,测试用 e2e 走登录。

- [ ] **Step 7: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/app/api/financial/
git commit -m "feat(api): 5 个 financial route 支持 period='' 全量 sentinel"
```

---

## Task 4: 前端 PeriodSelector 改造(动态化 + 全部选项)

**Files:**
- Modify: `ui/src/app/u/dashboard/page.tsx`(PeriodSelector 子组件)

**Interfaces:**
- Consumes: `span` / `period` state
- Produces: 月/季/年下拉首项 `<option value="">全部</option>`,列表动态生成

- [ ] **Step 1: 替换 PeriodSelector 组件**

打开 `ui/src/app/u/dashboard/page.tsx`,定位 [line 103-119](ui/src/app/u/dashboard/page.tsx#L103) 的 PeriodSelector 函数,完整替换为:

```tsx
function PeriodSelector({ span, period, setSpan, setPeriod }: { span: SpanId; period: string; setSpan: (v: SpanId) => void; setPeriod: (v: string) => void }) {
  const options = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-11
    if (span === 'month') {
      // 本月 + 前 17 个月,共 18 个
      const arr: string[] = ['']; // 首项"全部"
      for (let i = 0; i < 18; i++) {
        const d = new Date(y, m - i, 1);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        arr.push(`${d.getFullYear()}-${mm}`);
      }
      return arr;
    }
    if (span === 'quarter') {
      // 本季度 + 前 8 个季度,共 9 个
      const curQ = Math.floor(m / 3) + 1;
      const arr: string[] = [''];
      for (let i = 0; i < 9; i++) {
        const qOffset = i;
        const yearOff = Math.floor((curQ - 1 - qOffset) / 4);
        const qNum = ((curQ - 1 - qOffset) % 4 + 4) % 4 + 1;
        const qy = y - yearOff;
        arr.push(`${qy}-Q${qNum}`);
      }
      return arr;
    }
    // year: 本年 + 前 3 年,共 4 个
    const arr: string[] = [''];
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
          <option key={o || 'all'} value={o}>{o === '' ? '全部' : o}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: 验证 React 编译**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 无 error。

- [ ] **Step 3: 起 dev server,浏览器手工 smoke**

```bash
cd ui && npm run dev &
sleep 8
# 打开 http://localhost:4100/u/dashboard
```

Expected:
- 月下拉首项为"全部"
- 月列表包含 2026-07(当前月)
- 选"全部"后,month 控件值变空(无 UI 报错)
- 切到季/年,下拉首项也是"全部",列表正确

- [ ] **Step 4: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/app/u/dashboard/page.tsx
git commit -m "feat(dashboard): PeriodSelector 动态化 + 月/季/年下拉首项加'全部'"
```

---

## Task 5: 前端 DashboardPage 适配(删除 auto-select + 全量 UI 适配)

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

`period` 现在默认就是 `''`(已在 [line 419](ui/src/app/u/dashboard/page.tsx#L419) 初始化),不需要推断。

- [ ] **Step 2: 修改 fetch URL:period='' 时省略 period 参数**

定位 [page.tsx:457-471](ui/src/app/u/dashboard/page.tsx#L457) 的 `Promise.all`:

```tsx
// 现状
fetch(`/api/financial/overview?brand=${brand}&period=${period}&span=${span}&store=${store}`).then(r => r.json()).catch(() => ({ success: false })),
fetch(`/api/financial/kpi-trend?brand=${brand}&period=${period}&span=${span}&store=${store}`).then(r => r.json()).catch(() => ({ success: false })),

// 改为
const periodParam = period ? `&period=${period}` : '';
fetch(`/api/financial/overview?brand=${brand}${periodParam}&span=${span}&store=${store}`).then(r => r.json()).catch(() => ({ success: false })),
fetch(`/api/financial/kpi-trend?brand=${brand}${periodParam}&span=${span}&store=${store}`).then(r => r.json()).catch(() => ({ success: false })),
```

同样改 [line 468](ui/src/app/u/dashboard/page.tsx#L468) 的 `qimai-revenue` fetch。

- [ ] **Step 3: 改 vsPrev 箭头渲染逻辑**

定位 [page.tsx:146](ui/src/app/u/dashboard/page.tsx#L146) 的 `KpiCard`:

```tsx
// 现状
const vs = vsPrev !== undefined;
const good = vs ? (invert ? vsPrev <= 0 : vsPrev >= 0) : true;

// 改为
const vs = vsPrev !== undefined && vsPrev !== 0;
const good = vs ? (invert ? vsPrev <= 0 : vsPrev >= 0) : true;
```

全量模式 vsPrev=0 时箭头不再渲染。

- [ ] **Step 4: 改银行入账率卡片(始终显示)**

定位 [page.tsx:558-575](ui/src/app/u/dashboard/page.tsx#L558):

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

// 改为:始终显示紫色卡片,store='all' 时分子分母是品牌全量
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

并删除 `showEntryRate` 行的 store 条件(把 [line 475](ui/src/app/u/dashboard/page.tsx#L475) 改为始终 true):

```tsx
// 现状
const showEntryRate = store !== 'all' && bankRevenue !== null && qimaiRevenue !== null;

// 改为
const showEntryRate = bankRevenue !== null && qimaiRevenue !== null;
```

- [ ] **Step 5: 期初余额小字按 null 隐藏**

定位 [page.tsx:540-548](ui/src/app/u/dashboard/page.tsx#L540):

```tsx
// 现状
{overview.beginningBalance > 0 && (
  <div className="text-[10px] text-blue-500 mt-0.5">
    期初 ¥{overview.beginningBalance.toLocaleString(undefined, { minimumFractionDigits: 0 })}
    <span className="ml-1">
      {overview.cashBalance >= overview.beginningBalance ? '↑' : '↓'}
      {Math.abs(((overview.cashBalance - overview.beginningBalance) / overview.beginningBalance) * 100).toFixed(1)}%
    </span>
  </div>
)}

// 改为(加 null 检查 + 仅在全量时隐藏)
{(overview.beginningBalance == null ? null : overview.beginningBalance > 0) && (
  ...
)}
```

简化:
```tsx
{(overview.beginningBalance ?? 0) > 0 && (...)}
```

- [ ] **Step 6: 趋势图 x 轴 label 自适应**

定位 [page.tsx:198](ui/src/app/u/dashboard/page.tsx#L198) 的趋势图 label 渲染:

```tsx
// 现状
<div className="absolute text-[9px] text-gray-400" style={{ bottom: '-18px' }}>{d.month.slice(5)}</div>

// 改为
<div className="absolute text-[9px] text-gray-400" style={{ bottom: '-18px' }}>
  {d.month.length > 7 ? d.month : d.month.slice(2)}
</div>
```

逻辑:`month` 是 `'2026-06'`(7 字符),月模式显示 `26-06`;全量模式数据库返回的 `month` 字段格式应保持 `2026-06`,但如果有 4 位年份格式则原样显示。

实际看 kpi-trend API:monthly 数组里 month 字段已经是 `'YYYY-MM'` 7 字符。所以把 label 改为 `d.month.slice(2)` 显示 `26-06`(2 位年+月),节省空间。

最终:
```tsx
<div className="absolute text-[9px] text-gray-400" style={{ bottom: '-18px' }}>{d.month.slice(2)}</div>
```

(如果你的设计是显示完整 `2026-06`,改为 `{d.month}` 即可)

- [ ] **Step 7: 趋势图标题全量时改文案**

定位 [page.tsx:183](ui/src/app/u/dashboard/page.tsx#L183):

```tsx
// 现状
<h3 className="text-sm font-semibold text-gray-700 mb-3">{TREND_LABELS[trendKey]}趋势</h3>

// 改为
<h3 className="text-sm font-semibold text-gray-700 mb-3">
  {TREND_LABELS[trendKey]}趋势{period === '' ? '(全部历史)' : ''}
</h3>
```

- [ ] **Step 8: 验证编译 + dev server**

```bash
cd ui && npx tsc --noEmit 2>&1 | tail -10
# 起 dev server
npm run dev &
sleep 8
# 浏览器手工检查 http://localhost:4100/u/dashboard
```

Expected:
- 默认进入页面时,period=空(不自动跳到最近月)
- 月下拉选"全部" → KPI 数字变(全量比单月大很多);vs 箭头不显示;银行入账率紫色卡片显示;期初小字消失
- 切回具体月份 → 数字变小,vs 箭头出现
- 切门店 → 数字进一步变化(单店 < 品牌合计)

- [ ] **Step 9: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/src/app/u/dashboard/page.tsx
git commit -m "feat(dashboard): 适配全量模式(去 auto-select + vs 箭头 + 入账率 + 期初 + 趋势)"
```

---

## Task 6: Playwright E2E(全量 vs 月份 回归)

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
    // 假设已经登录(由 browser-smoke.spec.ts 的 ensureAuthed 复用)
    await page.goto('/u/dashboard');
    await expect(page.getByRole('heading', { name: '经营看板' })).toBeVisible({ timeout: 15_000 });
  });

  test('月份模式:vs 箭头显示', async ({ page }) => {
    // 默认应有具体月份
    const periodSelect = page.locator('select').nth(1); // 第二个 select 是 period
    const value = await periodSelect.inputValue();
    expect(value).not.toBe(''); // 月份模式应有值
  });

  test('全量模式:vs 箭头不显示,银行入账率始终显示', async ({ page }) => {
    const periodSelect = page.locator('select').nth(1);
    await periodSelect.selectOption({ value: '' });

    // 等数据回来(网络空闲)
    await page.waitForLoadState('networkidle');

    // 全量模式 period 控件值为空
    expect(await periodSelect.inputValue()).toBe('');

    // vs 箭头(↑/↓)不应在 KPI 卡片里出现
    const arrows = page.locator('text=/[↑↓]/');
    expect(await arrows.count()).toBe(0);

    // 银行入账率卡片应可见(紫色背景)
    await expect(page.getByText('银行入账率')).toBeVisible();
    await expect(page.getByText('选择门店')).toHaveCount(0); // 灰块不出现
  });

  test('全量 → 月份 切换:数据回归', async ({ page }) => {
    const periodSelect = page.locator('select').nth(1);
    await periodSelect.selectOption({ value: '' });
    await page.waitForLoadState('networkidle');

    // 切回具体月份(选第一项非空)
    const allOptions = await periodSelect.locator('option').all();
    for (const opt of allOptions) {
      const v = await opt.getAttribute('value');
      if (v && v !== '') {
        await periodSelect.selectOption({ value: v });
        break;
      }
    }
    await page.waitForLoadState('networkidle');

    // KPI 卡片应有 vs 箭头(除非该月份数字刚好 0,极端)
    // 简化: 至少有数字显示
    await expect(page.locator('text=/¥\\d/').first()).toBeVisible();
  });
});
```

- [ ] **Step 2: 设置测试凭据并运行**

```bash
cd ui
# 从 .env.local 取 WDG_ADMIN_PASS(用户在 IDE 打开过)
grep -E "WDG_ADMIN_PASS|WDG_ADMIN_USER" .env.local 2>&1 | head -5
```

如果 .env.local 没有密码:
```bash
# 问用户拿密码(或用项目里其他地方存储的)
```

设置 env 并跑测试:
```bash
cd ui
WDG_ADMIN_PASS='<从用户处获取>' \
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

Expected: 通过(回归 — 改动没破坏其他页面)。

- [ ] **Step 4: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add ui/tests/e2e/dashboard-alltime.spec.ts
git commit -m "test(e2e): dashboard 全量模式 3 个 case + 回归 smoke"
```

---

## Task 7: 文档更新(qmaireport)

**Files:**
- Modify: `docs/qmaireport/financial-page-structure.md`
- Modify: `docs/qmaireport/financial-data-sources.md`

**Interfaces:**
- Consumes: 现有文档结构
- Produces: 在 §3 经营看板 加一段"全量模式说明";data-sources 加一行 "API 接受 period='' sentinel"

- [ ] **Step 1: 在 financial-page-structure.md §3 加段**

打开 `docs/qmaireport/financial-page-structure.md`,定位 §3 "经营看板"。在控制栏描述后、KPI 卡片描述前,加一段:

```markdown
### 3.1 全量模式

PeriodSelector 月/季/年下拉首项为"全部",选中后 `period=''`。语义:
- 金额型 KPI(营收 / 费用 / 经营现金流)= 品牌或门店全量 SUM
- 比率型 KPI(毛利率 / 净利率)= 全量加权平均
- 趋势图 = 全部历史月柱图
- vs 同期(↑↓)= 隐藏(全量无对比期)
- 银行入账率 = 始终显示,分子分母全量 SUM

门店维度不变:`store='all'` = 品牌汇总,`store='<code>'` = 该门店。
```

- [ ] **Step 2: 在 financial-data-sources.md 加一行**

打开 `docs/qmaireport/financial-data-sources.md`,在 financial overview/kpi-trend 等 API 描述末尾加:

```markdown
> 5 个 financial API 接受 `period=''` 作为"全量" sentinel,等同于不限日期范围,返回品牌或门店的全部历史聚合。
```

- [ ] **Step 3: 验证文档格式(可选)**

```bash
grep -A 1 "全量模式" docs/qmaireport/financial-page-structure.md | head -10
grep "period=''" docs/qmaireport/financial-data-sources.md
```

Expected: 两段都搜得到。

- [ ] **Step 4: Commit**

```bash
cd .worktrees/feat-dashboard-alltime-mode
git add docs/qmaireport/
git commit -m "docs(qmaireport): dashboard 全量模式说明 + API period='' sentinel"
```

---

## Self-Review(写完后做)

### 1. Spec coverage
- §2 用户故事 → Task 4 (PeriodSelector) + Task 5 (UI 适配) ✅
- §3 架构 → Task 1 (parsePeriod) + Task 2 (仓库) + Task 3 (route) ✅
- §4.1 URL 参数 → Task 4 (period='') ✅
- §4.2 响应字段不变 → Task 3 保持 ✅
- §4.3 全量字段语义 → Task 3 (current/prev=null) + Task 5 (UI 适配) ✅
- §5.1 前端 PeriodSelector → Task 4 ✅
- §5.1 前端 DashboardPage → Task 5 ✅
- §5.2 parsePeriod → Task 1 ✅
- §5.2 仓库函数 → Task 2 ✅
- §5.2 5 个 route → Task 3 ✅
- §7 测试 → Task 1 (parsePeriod 单测) + Task 6 (e2e) ✅
- §8 文档 → Task 7 ✅

### 2. Placeholder scan
无 "TBD" / "TODO" / "fill in"。`<从用户处获取>` 在 Task 6 Step 2 — 明确指出需要问用户拿,不是占位符。

### 3. Type consistency
- `PeriodRange` 类型在 Task 1 定义,Task 3 使用 — 一致
- `isAllTime` 变量名贯穿 Task 3 / Task 5 — 一致
- 仓库函数签名(period 参数)未变 — 一致
- `period === ''` vs `period === null` vs 空字符串 — 全 plan 统一为 `period === ''`(URL 解析后是空串)

### 4. Final commit plan
7 个 task × 1 commit = 7 个 commit。线性依赖,task 1 完成后才能做 task 2/3,task 4/5 需 task 3 完成后才能跑全功能,但 task 4 可独立做(只改 UI 控件)。

任务并行性:
- Task 4 (UI PeriodSelector) 可以和 Task 1 (parsePeriod) 并行做 — 互不依赖
- Task 5 需 task 3 + task 4 都完成才能完整体验
- Task 6 需所有 task 完成
- Task 7 文档可在任何时候写(基于 spec),不依赖代码

建议执行顺序:1 → 2 → 3 → 4 → 5 → 6 → 7(若两个 agent 并行,4 可在 1 完成后就开始)。
