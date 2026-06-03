# 门店月报模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Next.js UI 中新增"门店月报"独立页面（`/u/store-report`），按品牌 × 门店 × 月份展示 9 个核心财务指标的当月快照 + 12 个月历史趋势，并支持 Excel 下载。

**Architecture:** 新建 `{brand}_dm.v_store_monthly_kpi` 视图（聚合现有 3 张财务视图）→ 3 个 API 端点（snapshot/trend/export）→ 4 个 React 组件（Filter/KpiCards/TrendChart/Page）→ 顶栏加「报表」菜单。Excel 用 SheetJS (`xlsx`) 服务端 in-memory 生成。

**Tech Stack:** PostgreSQL 视图、Next.js 14 API Routes、React 18 + Recharts、SheetJS `xlsx` (server-side)

**Spec:** [docs/superpowers/specs/2026-06-03-store-monthly-report-design.md](2026-06-03-store-monthly-report-design.md)

---

## 文件结构

### 新建
| 文件 | 职责 |
|---|---|
| `sql/40_store_monthly_kpi_view.sql` | 在 3 个 brand schema 下创建 `v_store_monthly_kpi` 视图 |
| `ui/src/lib/store-report-types.ts` | TypeScript 接口 (Snapshot, Trend, KpiSeries) |
| `ui/src/lib/store-report-queries.ts` | 前端 API client (fetch 封装) |
| `ui/src/lib/excel-export.ts` | xlsx 工具：4 Sheet 工作簿生成 |
| `ui/src/app/api/store-report/snapshot/route.ts` | 当月 + 上月 KPI |
| `ui/src/app/api/store-report/trend/route.ts` | 最近 N 月历史趋势 |
| `ui/src/app/api/store-report/export/route.ts` | Excel 下载 |
| `ui/src/app/u/store-report/page.tsx` | 主页面（数据编排） |
| `ui/src/app/u/store-report/StoreFilter.tsx` | 品牌/门店/月份筛选条 |
| `ui/src/app/u/store-report/KpiCards.tsx` | 9 张 KPI 卡片（5+4 网格） |
| `ui/src/app/u/store-report/TrendChart.tsx` | recharts LineChart 包装 |

### 修改
| 文件 | 变更 |
|---|---|
| `ui/package.json` | 新增依赖 `xlsx` |
| `ui/src/app/providers.tsx` | 顶栏新增「报表」下拉菜单 |
| `ui/src/app/u/dashboard/page.tsx` | 快捷入口补一张「门店月报」卡 |

---

## 任务列表

### Task 1: 创建功能分支

**Files:**
- 工作目录切换

- [ ] **Step 1: 从当前分支创建新分支**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git checkout -b feat/store-monthly-report
```

预期：`Switched to a new branch 'feat/store-monthly-report'`

- [ ] **Step 2: 确认分支**

```bash
git branch --show-current
```

预期输出：`feat/store-monthly-report`

- [ ] **Step 3: 暂不提交任何东西**

此任务无文件变更。

---

### Task 2: 添加 xlsx 依赖

**Files:**
- Modify: `ui/package.json`
- Modify: `ui/package-lock.json` (npm 自动生成)

- [ ] **Step 1: 在 ui/ 目录下安装 xlsx**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npm install xlsx@0.18.5
```

预期输出：`added 1 package` 或类似（不报错）

- [ ] **Step 2: 验证 package.json 更新**

```bash
grep '"xlsx"' package.json
```

预期输出：`"xlsx": "^0.18.5"` 一行

- [ ] **Step 3: 验证可正常 import**

```bash
node -e "const xlsx = require('xlsx'); console.log('xlsx OK, version:', xlsx.version);"
```

预期输出：`xlsx OK, version: 0.18.5`

- [ ] **Step 4: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/package.json ui/package-lock.json
git commit -m "chore(ui): add xlsx dep for store report Excel export"
```

---

### Task 3: 创建 SQL 视图 DDL

**Files:**
- Create: `sql/40_store_monthly_kpi_view.sql`

- [ ] **Step 1: 创建 SQL 文件**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/sql/40_store_monthly_kpi_view.sql`：

```sql
-- ============================================================
-- v_store_monthly_kpi: 门店月报专用视图
-- 一行 = (品牌 schema 内) 1 月 × 1 门店，9 个核心财务指标 + 中间量
-- 依赖：v_profit_statement / v_cashflow_statement / v_balance_sheet
-- 适用：bonjur_dm / brand_gelatomiiix_dm / brand_tamkoko_dm
-- ============================================================

-- bonjur_dm
CREATE OR REPLACE VIEW bonjur_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END) AS cost_amt,
    SUM(CASE WHEN section = 'expense'  THEN amount ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM bonjur_dm.v_profit_statement GROUP BY month, store_code
),
cashflow_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END) AS operating_cf_amt,
    SUM(total_in)  AS total_in_amt,
    SUM(total_out) AS total_out_amt
  FROM bonjur_dm.v_cashflow_statement GROUP BY month, store_code
)
SELECT
  p.month, p.store_code,
  p.revenue_amt, p.cost_amt, p.expense_amt, p.hr_amt, p.rent_amt,
  p.revenue_amt - p.cost_amt AS gross_profit_amt,
  p.revenue_amt - p.cost_amt - p.expense_amt AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(p.hr_amt::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(p.rent_amt::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN bonjur_dm.v_balance_sheet b USING (month, store_code);

-- brand_gelatomiiix_dm
CREATE OR REPLACE VIEW brand_gelatomiiix_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END) AS cost_amt,
    SUM(CASE WHEN section = 'expense'  THEN amount ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM brand_gelatomiiix_dm.v_profit_statement GROUP BY month, store_code
),
cashflow_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END) AS operating_cf_amt,
    SUM(total_in)  AS total_in_amt,
    SUM(total_out) AS total_out_amt
  FROM brand_gelatomiiix_dm.v_cashflow_statement GROUP BY month, store_code
)
SELECT
  p.month, p.store_code,
  p.revenue_amt, p.cost_amt, p.expense_amt, p.hr_amt, p.rent_amt,
  p.revenue_amt - p.cost_amt AS gross_profit_amt,
  p.revenue_amt - p.cost_amt - p.expense_amt AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(p.hr_amt::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(p.rent_amt::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN brand_gelatomiiix_dm.v_balance_sheet b USING (month, store_code);

-- brand_tamkoko_dm
CREATE OR REPLACE VIEW brand_tamkoko_dm.v_store_monthly_kpi AS
WITH profit_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN section = 'revenue' THEN amount ELSE 0 END) AS revenue_amt,
    SUM(CASE WHEN section = 'cost'     THEN amount ELSE 0 END) AS cost_amt,
    SUM(CASE WHEN section = 'expense'  THEN amount ELSE 0 END) AS expense_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'HR'        THEN amount ELSE 0 END) AS hr_amt,
    SUM(CASE WHEN section = 'expense' AND lvl1_code = 'RENT_UTIL' THEN amount ELSE 0 END) AS rent_amt
  FROM brand_tamkoko_dm.v_profit_statement GROUP BY month, store_code
),
cashflow_agg AS (
  SELECT
    month, store_code,
    SUM(CASE WHEN activity = 'operating' THEN net_amount ELSE 0 END) AS operating_cf_amt,
    SUM(total_in)  AS total_in_amt,
    SUM(total_out) AS total_out_amt
  FROM brand_tamkoko_dm.v_cashflow_statement GROUP BY month, store_code
)
SELECT
  p.month, p.store_code,
  p.revenue_amt, p.cost_amt, p.expense_amt, p.hr_amt, p.rent_amt,
  p.revenue_amt - p.cost_amt AS gross_profit_amt,
  p.revenue_amt - p.cost_amt - p.expense_amt AS net_profit_amt,
  c.operating_cf_amt, c.total_in_amt, c.total_out_amt,
  b.cash_balance, b.loan_balance,
  CASE WHEN c.operating_cf_amt < 0
    THEN ROUND(b.cash_balance / ABS(c.operating_cf_amt), 1)
  END AS cashflow_runway_months,
  ROUND(p.hr_amt::numeric  / NULLIF(p.revenue_amt, 0) * 100, 1) AS hr_ratio_pct,
  ROUND(p.rent_amt::numeric / NULLIF(p.revenue_amt, 0) * 100, 1) AS rent_ratio_pct
FROM profit_agg p
LEFT JOIN cashflow_agg c USING (month, store_code)
LEFT JOIN brand_tamkoko_dm.v_balance_sheet b USING (month, store_code);
```

- [ ] **Step 2: 在远程 DB 执行（用 Node 一次性脚本）**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
node -e "
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const { Client } = require('pg');
const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
const sql = fs.readFileSync('/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/sql/40_store_monthly_kpi_view.sql','utf8');
(async () => {
  await c.connect();
  await c.query(sql);
  console.log('view created OK');
  for (const s of ['bonjur_dm','brand_gelatomiiix_dm','brand_tamkoko_dm']) {
    const r = await c.query(\"SELECT to_regclass(\$1 || '.v_store_monthly_kpi') AS oid\", [s]);
    console.log(s + ':', r.rows[0].oid);
  }
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
"
```

预期输出：
```
view created OK
bonjur_dm: bonjur_dm.v_store_monthly_kpi
brand_gelatomiiix_dm: brand_gelatomiiix_dm.v_store_monthly_kpi
brand_tamkoko_dm: brand_tamkoko_dm.v_store_monthly_kpi
```

- [ ] **Step 3: 抽样验证数据**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
node -e "
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const { Client } = require('pg');
const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
(async () => {
  await c.connect();
  const r = await c.query('SELECT month, store_code, revenue_amt, expense_amt, gross_profit_amt, hr_ratio_pct, rent_ratio_pct FROM bonjur_dm.v_store_monthly_kpi ORDER BY month DESC, store_code LIMIT 5');
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
})();
"
```

预期：返回最近 5 行（可能为空 schema，无数据时返回 `[]`，正常）。

- [ ] **Step 4: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add sql/40_store_monthly_kpi_view.sql
git commit -m "feat(sql): add v_store_monthly_kpi view for 3 brand schemas"
```

---

### Task 4: 定义 TypeScript 接口

**Files:**
- Create: `ui/src/lib/store-report-types.ts`

- [ ] **Step 1: 创建类型文件**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/lib/store-report-types.ts`：

```typescript
// 门店月报模块共享类型

export type Brand = 'gelatomiiix' | 'bonjur' | 'xintiandi';

export interface StoreKpi {
  month: string; // YYYY-MM
  revenue_amt: number;
  cost_amt: number;
  expense_amt: number;
  hr_amt: number;
  rent_amt: number;
  gross_profit_amt: number;
  net_profit_amt: number;
  operating_cf_amt: number;
  total_in_amt: number;
  total_out_amt: number;
  cash_balance: number;
  loan_balance: number;
  cashflow_runway_months: number | null;
  hr_ratio_pct: number | null;
  rent_ratio_pct: number | null;
}

export interface SnapshotResponse {
  current: StoreKpi;
  previous: StoreKpi | null;
}

export type KpiMetricKey =
  | 'revenue_amt'
  | 'expense_amt'
  | 'gross_profit_amt'
  | 'net_profit_amt'
  | 'operating_cf_amt'
  | 'cash_balance'
  | 'cashflow_runway_months'
  | 'hr_ratio_pct'
  | 'rent_ratio_pct';

export const KPI_LABELS: Record<KpiMetricKey, string> = {
  revenue_amt: '营业收入',
  expense_amt: '营业支出',
  gross_profit_amt: '毛利',
  net_profit_amt: '净利润',
  operating_cf_amt: '经营现金流',
  cash_balance: '银行余额',
  cashflow_runway_months: '现金流月数',
  hr_ratio_pct: '人力占比率',
  rent_ratio_pct: '租金占比率',
};

// Excel 导出包含的更宽指标集（含中间量 cost_amt / hr_amt / rent_amt / loan_balance）
export type ExcelMetricKey =
  | KpiMetricKey
  | 'cost_amt'
  | 'hr_amt'
  | 'rent_amt'
  | 'loan_balance';

export const EXCEL_METRIC_LABELS: Record<ExcelMetricKey, string> = {
  ...KPI_LABELS,
  cost_amt: '营业成本',
  hr_amt: '人力',
  rent_amt: '租金',
  loan_balance: '贷款余额',
};

export interface TrendResponse {
  months: string[]; // YYYY-MM
  series: Record<KpiMetricKey, (number | null)[]>;
}

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  note?: string;
  error?: string;
}
```

- [ ] **Step 2: TypeScript 类型检查通过**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误（命令无输出或 `tsc done` 之类成功消息）。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/lib/store-report-types.ts
git commit -m "feat(types): add store report shared types"
```

---

### Task 5: 实现 snapshot API

**Files:**
- Create: `ui/src/app/api/store-report/snapshot/route.ts`

- [ ] **Step 1: 实现路由**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/api/store-report/snapshot/route.ts`：

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import type { ApiResult, SnapshotResponse, StoreKpi } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json<ApiResult<SnapshotResponse>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const month = searchParams.get('month'); // YYYY-MM

    if (!brandRaw || !store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, error: 'Missing or invalid params: brand, store, month (YYYY-MM)' },
        { status: 400 }
      );
    }

    const brand = normalizeBrand(brandRaw);
    const schema = await getDmSchemaSafe(brand);
    if (!schema) {
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, error: `Unknown brand: ${brandRaw}` },
        { status: 400 }
      );
    }

    const prevMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return `${py}-${String(pm).padStart(2, '0')}`;
    })();

    let currentRows: StoreKpi[];
    let previousRows: StoreKpi[] = [];
    try {
      const cur = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE month = $1 AND store_code = $2`,
        [month, store]
      );
      currentRows = cur.rows;
      if (currentRows.length === 0) {
        return NextResponse.json<ApiResult<SnapshotResponse>>(
          { success: false, error: `No data for ${store}@${month}` },
          { status: 404 }
        );
      }
      const prev = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE month = $1 AND store_code = $2`,
        [prevMonth, store]
      );
      previousRows = prev.rows;
    } catch (e: any) {
      if (e?.code === PG_ERR_NO_VIEW) {
        return NextResponse.json<ApiResult<SnapshotResponse>>(
          { success: true, data: null, note: 'view not ready' }
        );
      }
      throw e;
    }

    const toKpi = (r: any): StoreKpi => ({
      month: r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month),
      revenue_amt: Number(r.revenue_amt),
      cost_amt: Number(r.cost_amt),
      expense_amt: Number(r.expense_amt),
      hr_amt: Number(r.hr_amt),
      rent_amt: Number(r.rent_amt),
      gross_profit_amt: Number(r.gross_profit_amt),
      net_profit_amt: Number(r.net_profit_amt),
      operating_cf_amt: Number(r.operating_cf_amt),
      total_in_amt: Number(r.total_in_amt),
      total_out_amt: Number(r.total_out_amt),
      cash_balance: Number(r.cash_balance),
      loan_balance: Number(r.loan_balance),
      cashflow_runway_months: r.cashflow_runway_months == null ? null : Number(r.cashflow_runway_months),
      hr_ratio_pct: r.hr_ratio_pct == null ? null : Number(r.hr_ratio_pct),
      rent_ratio_pct: r.rent_ratio_pct == null ? null : Number(r.rent_ratio_pct),
    });

    return NextResponse.json<ApiResult<SnapshotResponse>>({
      success: true,
      data: {
        current: toKpi(currentRows[0]),
        previous: previousRows[0] ? toKpi(previousRows[0]) : null,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json<ApiResult<SnapshotResponse>>(
      { success: false, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/api/store-report/snapshot/route.ts
git commit -m "feat(api): store-report snapshot endpoint"
```

---

### Task 6: 实现 trend API

**Files:**
- Create: `ui/src/app/api/store-report/trend/route.ts`

- [ ] **Step 1: 实现路由**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/api/store-report/trend/route.ts`：

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import type { ApiResult, TrendResponse, KpiMetricKey } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json<ApiResult<TrendResponse>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const monthsParam = searchParams.get('months') ?? '12';

    if (!brandRaw || !store) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: false, error: 'Missing params: brand, store' },
        { status: 400 }
      );
    }

    const months = Math.min(Math.max(parseInt(monthsParam, 10) || 12, 1), 24);

    const brand = normalizeBrand(brandRaw);
    const schema = await getDmSchemaSafe(brand);
    if (!schema) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: false, error: `Unknown brand: ${brandRaw}` },
        { status: 400 }
      );
    }

    let rows: any[];
    try {
      const r = await pool.query(
        `SELECT month,
                revenue_amt, expense_amt, gross_profit_amt, net_profit_amt,
                operating_cf_amt, cash_balance, cashflow_runway_months,
                hr_ratio_pct, rent_ratio_pct
         FROM ${schema}.v_store_monthly_kpi
         WHERE store_code = $1
         ORDER BY month DESC
         LIMIT $2`,
        [store, months]
      );
      rows = r.rows.reverse();
    } catch (e: any) {
      if (e?.code === PG_ERR_NO_VIEW) {
        return NextResponse.json<ApiResult<TrendResponse>>(
          { success: true, data: null, note: 'view not ready' }
        );
      }
      throw e;
    }

    const seriesKeys: KpiMetricKey[] = [
      'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt',
      'operating_cf_amt', 'cash_balance', 'cashflow_runway_months',
      'hr_ratio_pct', 'rent_ratio_pct',
    ];
    const series = {} as Record<KpiMetricKey, (number | null)[]>;
    for (const k of seriesKeys) series[k] = [];
    const monthList: string[] = [];

    for (const r of rows) {
      const m = r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month);
      monthList.push(m);
      for (const k of seriesKeys) {
        const v = r[k as string];
        series[k].push(v == null ? null : Number(v));
      }
    }

    return NextResponse.json<ApiResult<TrendResponse>>({
      success: true,
      data: { months: monthList, series },
    });
  } catch (err: unknown) {
    return NextResponse.json<ApiResult<TrendResponse>>(
      { success: false, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/api/store-report/trend/route.ts
git commit -m "feat(api): store-report trend endpoint"
```

---

### Task 7: 实现 Excel 导出工具

**Files:**
- Create: `ui/src/lib/excel-export.ts`

- [ ] **Step 1: 实现工具函数**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/lib/excel-export.ts`：

```typescript
import * as XLSX from 'xlsx';
import type { SnapshotResponse, StoreKpi, TrendResponse } from './store-report-types';
import { ExcelMetricKey, EXCEL_METRIC_LABELS } from './store-report-types';

const ALL_METRICS: ExcelMetricKey[] = [
  'revenue_amt', 'cost_amt', 'expense_amt', 'hr_amt', 'rent_amt',
  'gross_profit_amt', 'net_profit_amt', 'operating_cf_amt',
  'cash_balance', 'loan_balance', 'cashflow_runway_months',
  'hr_ratio_pct', 'rent_ratio_pct',
];

function fmtAmt(n: number | null | undefined): number | string {
  if (n == null) return '';
  return Math.round(Number(n) * 100) / 100;
}

function fmtPct(n: number | null | undefined): number | string {
  if (n == null) return '';
  return Math.round(Number(n) * 10) / 10;
}

function fmtMonths(n: number | null | undefined): number | string {
  if (n == null) return '';
  return Math.round(Number(n) * 10) / 10;
}

function fmtCell(key: ExcelMetricKey, v: number | null | undefined): number | string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct') return fmtPct(v);
  if (key === 'cashflow_runway_months') return fmtMonths(v);
  return fmtAmt(v);
}

export interface ExportInput {
  brand: string;
  store: string;
  month: string;
  generatedAt: Date;
  snapshot: SnapshotResponse;
  trend: TrendResponse;
}

export function buildStoreReportWorkbook(input: ExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: 门店信息
  const infoRows = [
    ['品牌', input.brand],
    ['门店', input.store],
    ['月份', input.month],
    ['生成时间', input.generatedAt.toISOString()],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(infoRows);
  XLSX.utils.book_append_sheet(wb, ws1, '门店信息');

  // Sheet 2: 当月快照
  const cur = input.snapshot.current;
  const prev = input.snapshot.previous;
  const snapRows: any[][] = [['指标', '当月值', '上月值', '环比%']];
  for (const key of ALL_METRICS) {
    const curV = (cur as any)[key];
    const prevV = prev ? (prev as any)[key] : null;
    let delta: number | string = '';
    if (prevV != null && curV != null && Number(prevV) !== 0) {
      delta = Math.round(((Number(curV) - Number(prevV)) / Math.abs(Number(prevV))) * 1000) / 10;
    }
    snapRows.push([
      EXCEL_METRIC_LABELS[key] ?? key,
      fmtCell(key, curV),
      prevV == null ? '' : fmtCell(key, prevV),
      delta,
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(snapRows);
  XLSX.utils.book_append_sheet(wb, ws2, '当月快照');

  // Sheet 3: 历史趋势
  const trendHeader = ['月份', ...ALL_METRICS.map(k => EXCEL_METRIC_LABELS[k] ?? k)];
  const trendRows: any[][] = [trendHeader];
  for (let i = 0; i < input.trend.months.length; i++) {
    const row = [input.trend.months[i]];
    for (const key of ALL_METRICS) {
      const v = (input.trend.series as any)[key]?.[i];
      row.push(fmtCell(key, v));
    }
    trendRows.push(row);
  }
  const ws3 = XLSX.utils.aoa_to_sheet(trendRows);
  XLSX.utils.book_append_sheet(wb, ws3, '历史趋势');

  // Sheet 4: 同期对比 (当月 vs 去年同期)
  const yoy = (() => {
    const [y, m] = input.month.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}`;
  })();
  const yoyIndex = input.trend.months.indexOf(yoy);
  const yoyKpi: StoreKpi | null = yoyIndex >= 0 ? {
    month: yoy,
    revenue_amt: input.trend.series.revenue_amt[yoyIndex] ?? 0,
    cost_amt: 0, expense_amt: input.trend.series.expense_amt[yoyIndex] ?? 0,
    hr_amt: 0, rent_amt: 0,
    gross_profit_amt: input.trend.series.gross_profit_amt[yoyIndex] ?? 0,
    net_profit_amt: input.trend.series.net_profit_amt[yoyIndex] ?? 0,
    operating_cf_amt: input.trend.series.operating_cf_amt[yoyIndex] ?? 0,
    total_in_amt: 0, total_out_amt: 0,
    cash_balance: input.trend.series.cash_balance[yoyIndex] ?? 0,
    loan_balance: 0,
    cashflow_runway_months: input.trend.series.cashflow_runway_months[yoyIndex] ?? null,
    hr_ratio_pct: input.trend.series.hr_ratio_pct[yoyIndex] ?? null,
    rent_ratio_pct: input.trend.series.rent_ratio_pct[yoyIndex] ?? null,
  } : null;

  const yoyRows: any[][] = [
    ['指标', `当月 (${input.month})`, `去年同期 (${yoy})`, '同比%'],
  ];
  for (const key of ALL_METRICS) {
    const curV = (cur as any)[key];
    const yoyV = yoyKpi ? (yoyKpi as any)[key] : null;
    let delta: number | string = '';
    if (yoyV != null && curV != null && Number(yoyV) !== 0) {
      delta = Math.round(((Number(curV) - Number(yoyV)) / Math.abs(Number(yoyV))) * 1000) / 10;
    }
    yoyRows.push([
      EXCEL_METRIC_LABELS[key] ?? key,
      fmtCell(key, curV),
      yoyV == null ? '(无数据)' : fmtCell(key, yoyV),
      delta,
    ]);
  }
  const ws4 = XLSX.utils.aoa_to_sheet(yoyRows);
  XLSX.utils.book_append_sheet(wb, ws4, '同期对比');

  return wb;
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(buf);
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -10
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/lib/excel-export.ts
git commit -m "feat(lib): excel export utility for store report"
```

---

### Task 8: 实现 export API

**Files:**
- Create: `ui/src/app/api/store-report/export/route.ts`

- [ ] **Step 1: 实现路由**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/api/store-report/export/route.ts`：

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { buildStoreReportWorkbook, workbookToBuffer } from '@/lib/excel-export';
import type { SnapshotResponse, StoreKpi, TrendResponse, KpiMetricKey } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const month = searchParams.get('month');

    if (!brandRaw || !store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid params: brand, store, month (YYYY-MM)' },
        { status: 400 }
      );
    }

    const brand = normalizeBrand(brandRaw);
    const schema = await getDmSchemaSafe(brand);
    if (!schema) {
      return NextResponse.json({ success: false, error: `Unknown brand: ${brandRaw}` }, { status: 400 });
    }

    const prevMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return `${py}-${String(pm).padStart(2, '0')}`;
    })();

    let snapshot: SnapshotResponse;
    let trend: TrendResponse;
    try {
      const cur = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE month = $1 AND store_code = $2`,
        [month, store]
      );
      if (cur.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'No data' }, { status: 404 });
      }
      const prev = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE month = $1 AND store_code = $2`,
        [prevMonth, store]
      );

      const toKpi = (r: any): StoreKpi => ({
        month: r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month),
        revenue_amt: Number(r.revenue_amt), cost_amt: Number(r.cost_amt), expense_amt: Number(r.expense_amt),
        hr_amt: Number(r.hr_amt), rent_amt: Number(r.rent_amt),
        gross_profit_amt: Number(r.gross_profit_amt), net_profit_amt: Number(r.net_profit_amt),
        operating_cf_amt: Number(r.operating_cf_amt), total_in_amt: Number(r.total_in_amt), total_out_amt: Number(r.total_out_amt),
        cash_balance: Number(r.cash_balance), loan_balance: Number(r.loan_balance),
        cashflow_runway_months: r.cashflow_runway_months == null ? null : Number(r.cashflow_runway_months),
        hr_ratio_pct: r.hr_ratio_pct == null ? null : Number(r.hr_ratio_pct),
        rent_ratio_pct: r.rent_ratio_pct == null ? null : Number(r.rent_ratio_pct),
      });
      snapshot = { current: toKpi(cur.rows[0]), previous: prev.rows[0] ? toKpi(prev.rows[0]) : null };

      const tr = await pool.query(
        `SELECT month, revenue_amt, expense_amt, gross_profit_amt, net_profit_amt,
                operating_cf_amt, cash_balance, cashflow_runway_months,
                hr_ratio_pct, rent_ratio_pct
         FROM ${schema}.v_store_monthly_kpi
         WHERE store_code = $1
         ORDER BY month DESC LIMIT 12`,
        [store]
      );
      const sorted = tr.rows.reverse();
      const keys: KpiMetricKey[] = [
        'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt',
        'operating_cf_amt', 'cash_balance', 'cashflow_runway_months',
        'hr_ratio_pct', 'rent_ratio_pct',
      ];
      const series = {} as Record<KpiMetricKey, (number | null)[]>;
      for (const k of keys) series[k] = [];
      const monthList: string[] = [];
      for (const r of sorted) {
        const m = r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month);
        monthList.push(m);
        for (const k of keys) {
          const v = r[k as string];
          series[k].push(v == null ? null : Number(v));
        }
      }
      trend = { months: monthList, series };
    } catch (e: any) {
      if (e?.code === PG_ERR_NO_VIEW) {
        return NextResponse.json({ success: true, data: null, note: 'view not ready' });
      }
      throw e;
    }

    const wb = buildStoreReportWorkbook({
      brand: brandRaw, store, month, generatedAt: new Date(), snapshot, trend,
    });
    const buf = workbookToBuffer(wb);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${brandRaw}_${store}_${month}.xlsx"`,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -10
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/api/store-report/export/route.ts
git commit -m "feat(api): store-report Excel export endpoint"
```

---

### Task 9: 实现前端 API client

**Files:**
- Create: `ui/src/lib/store-report-queries.ts`

- [ ] **Step 1: 实现 client**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/lib/store-report-queries.ts`：

```typescript
import type { ApiResult, SnapshotResponse, TrendResponse } from './store-report-types';

async function get<T>(url: string): Promise<ApiResult<T>> {
  const res = await fetch(url, { cache: 'no-store' });
  return res.json() as Promise<ApiResult<T>>;
}

export function fetchSnapshot(brand: string, store: string, month: string): Promise<ApiResult<SnapshotResponse>> {
  const qs = new URLSearchParams({ brand, store, month }).toString();
  return get<SnapshotResponse>(`/api/store-report/snapshot?${qs}`);
}

export function fetchTrend(brand: string, store: string, months = 12): Promise<ApiResult<TrendResponse>> {
  const qs = new URLSearchParams({ brand, store, months: String(months) }).toString();
  return get<TrendResponse>(`/api/store-report/trend?${qs}`);
}

export function exportUrl(brand: string, store: string, month: string): string {
  const qs = new URLSearchParams({ brand, store, month }).toString();
  return `/api/store-report/export?${qs}`;
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/lib/store-report-queries.ts
git commit -m "feat(lib): store report API client"
```

---

### Task 10: 实现 StoreFilter 组件

**Files:**
- Create: `ui/src/app/u/store-report/StoreFilter.tsx`

- [ ] **Step 1: 实现组件**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/u/store-report/StoreFilter.tsx`：

```typescript
'use client';

interface Store {
  code: string;
  name: string;
}

interface Props {
  brand: string;
  brandOptions: { code: string; name: string }[];
  onBrandChange: (b: string) => void;

  stores: Store[];
  store: string;
  onStoreChange: (s: string) => void;

  month: string;
  onMonthChange: (m: string) => void;
}

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1 - i;
    const yy = m <= 0 ? y - 1 : y;
    const mm = m <= 0 ? 12 + m : m;
    out.push(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  return out.reverse();
}

export function StoreFilter({
  brand, brandOptions, onBrandChange,
  stores, store, onStoreChange,
  month, onMonthChange,
}: Props) {
  const months = lastNMonths(24);

  return (
    <div className="flex flex-wrap gap-4 items-end bg-white p-4 rounded border mb-4">
      <div>
        <label className="block text-xs text-gray-500 mb-1">品牌</label>
        <select
          value={brand}
          onChange={e => onBrandChange(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[120px]"
        >
          {brandOptions.map(b => (
            <option key={b.code} value={b.code}>{b.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">门店</label>
        <select
          value={store}
          onChange={e => onStoreChange(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[180px]"
        >
          {stores.length === 0 && <option value="">(暂无门店)</option>}
          {stores.map(s => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">月份</label>
        <select
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[120px]"
        >
          {months.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export { defaultMonth };
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/u/store-report/StoreFilter.tsx
git commit -m "feat(ui): store report filter component"
```

---

### Task 11: 实现 KpiCards 组件

**Files:**
- Create: `ui/src/app/u/store-report/KpiCards.tsx`

- [ ] **Step 1: 实现组件**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/u/store-report/KpiCards.tsx`：

```typescript
'use client';

import type { StoreKpi, KpiMetricKey } from '@/lib/store-report-types';
import { KPI_LABELS } from '@/lib/store-report-types';

const CARD_ORDER: KpiMetricKey[] = [
  'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt', 'operating_cf_amt',
  'cash_balance', 'cashflow_runway_months', 'hr_ratio_pct', 'rent_ratio_pct',
];

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '-';
  const abs = Math.abs(n);
  if (abs >= 100000000) return `¥${(n / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toFixed(0)}`;
}

function fmtMonths(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toFixed(1);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${n.toFixed(1)}%`;
}

function fmtValue(key: KpiMetricKey, n: number | null | undefined): string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct') return fmtPct(n);
  if (key === 'cashflow_runway_months') return fmtMonths(n);
  return fmtCurrency(n);
}

function fmtDeltaPct(delta: number | null): { text: string; color: string; arrow: string } {
  if (delta == null || !isFinite(delta)) return { text: '-', color: 'text-gray-400', arrow: '' };
  const sign = delta > 0 ? '↑' : delta < 0 ? '↓' : '';
  const color = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-500';
  return { text: `${Math.abs(delta).toFixed(1)}%`, color, arrow: sign };
}

function calcDelta(key: KpiMetricKey, cur: StoreKpi, prev: StoreKpi | null): number | null {
  if (!prev) return null;
  const curV = (cur as any)[key] as number | null;
  const prevV = (prev as any)[key] as number | null;
  if (curV == null || prevV == null || prevV === 0) return null;
  return ((curV - prevV) / Math.abs(prevV)) * 100;
}

interface Props {
  current: StoreKpi;
  previous: StoreKpi | null;
}

export function KpiCards({ current, previous }: Props) {
  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {CARD_ORDER.map(key => {
        const curV = (current as any)[key];
        const delta = calcDelta(key, current, previous);
        const { text, color, arrow } = fmtDeltaPct(delta);
        return (
          <div key={key} className="bg-white rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">{KPI_LABELS[key]}</div>
            <div className="text-lg font-semibold text-gray-900">{fmtValue(key, curV)}</div>
            <div className={`text-xs ${color} mt-1`}>{arrow} {text}</div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/u/store-report/KpiCards.tsx
git commit -m "feat(ui): store report KPI cards component"
```

---

### Task 12: 实现 TrendChart 组件

**Files:**
- Create: `ui/src/app/u/store-report/TrendChart.tsx`

- [ ] **Step 1: 实现组件**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/u/store-report/TrendChart.tsx`：

```typescript
'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { TrendResponse, KpiMetricKey } from '@/lib/store-report-types';
import { KPI_LABELS } from '@/lib/store-report-types';

interface Props {
  title: string;
  trend: TrendResponse;
  metrics: KpiMetricKey[]; // 1 or 2 metrics (双线)
  colors?: string[];
}

const DEFAULT_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04'];

function fmtY(key: KpiMetricKey, n: number): string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct') return `${n.toFixed(1)}%`;
  if (key === 'cashflow_runway_months') return n.toFixed(1);
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(0)}万`;
  return n.toFixed(0);
}

export function TrendChart({ title, trend, metrics, colors = DEFAULT_COLORS }: Props) {
  const data = trend.months.map((m, i) => {
    const row: any = { month: m };
    for (const k of metrics) row[k] = trend.series[k]?.[i] ?? null;
    return row;
  });

  return (
    <div className="bg-white rounded border p-3">
      <div className="text-sm font-medium text-gray-700 mb-2">{title}</div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtY(metrics[0], Number(v))} width={50} />
            <Tooltip formatter={(v: any, n: any) => [fmtY(metrics[0], Number(v)), KPI_LABELS[n as KpiMetricKey] ?? n]} />
            <Legend formatter={n => KPI_LABELS[n as KpiMetricKey] ?? n} />
            {metrics.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/u/store-report/TrendChart.tsx
git commit -m "feat(ui): store report trend chart component"
```

---

### Task 13: 实现主页面

**Files:**
- Create: `ui/src/app/u/store-report/page.tsx`

- [ ] **Step 1: 实现页面**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c/ui/src/app/u/store-report/page.tsx`：

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBrand } from '@/lib/brand-context';
import { fetchBrands } from '@/lib/brands-client';
import { fetchSnapshot, fetchTrend, exportUrl } from '@/lib/store-report-queries';
import type { ApiResult, SnapshotResponse, StoreKpi, TrendResponse } from '@/lib/store-report-types';
import { StoreFilter, defaultMonth } from './StoreFilter';
import { KpiCards } from './KpiCards';
import { TrendChart } from './TrendChart';

const BRAND_OPTIONS_HARDCODED = [
  { code: 'gelatomiiix', name: 'Gelatomiiix' },
  { code: 'bonjur', name: 'Bonjur' },
  { code: 'xintiandi', name: 'Xintiandi' },
];

interface StoreOpt { code: string; name: string; }

export default function StoreReportPage() {
  const { brand: ctxBrand } = useBrand();
  const [brandOptions, setBrandOptions] = useState(BRAND_OPTIONS_HARDCODED);
  const [brand, setBrand] = useState(ctxBrand || 'gelatomiiix');
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [store, setStore] = useState('');
  const [month, setMonth] = useState(defaultMonth());

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrands()
      .then(rows => {
        if (rows.length) setBrandOptions(rows.map(r => ({ code: r.brand_code, name: r.brand_name })));
      })
      .catch(() => {});
  }, []);

  // 拉门店列表
  useEffect(() => {
    setStores([]);
    setStore('');
    fetch(`/api/stores?brand=${encodeURIComponent(brand)}`)
      .then(r => r.json())
      .then((d: ApiResult<StoreOpt[]>) => {
        if (d.success && d.data && d.data.length > 0) {
          setStores(d.data);
          setStore(d.data[0].code);
        } else {
          setStores([]);
        }
      })
      .catch(() => setStores([]));
  }, [brand]);

  const loadTrend = useCallback(async (b: string, s: string) => {
    if (!s) return;
    const r = await fetchTrend(b, s, 12);
    if (r.success && r.data) setTrend(r.data);
    else setTrend(null);
  }, []);

  const loadSnapshot = useCallback(async (b: string, s: string, m: string) => {
    if (!s || !m) return;
    setLoading(true);
    setError(null);
    setNote(null);
    const r = await fetchSnapshot(b, s, m);
    if (r.success && r.data) {
      setSnapshot(r.data);
      if (r.note) setNote(r.note);
    } else {
      setSnapshot(null);
      setError(r.error ?? '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (store && month) loadSnapshot(brand, store, month);
  }, [brand, store, month, loadSnapshot]);

  useEffect(() => {
    if (store) loadTrend(brand, store);
  }, [brand, store, loadTrend]);

  const current: StoreKpi | null = snapshot?.current ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">门店月报</h1>
        {store && month && (
          <a
            href={exportUrl(brand, store, month)}
            className="text-sm border rounded px-3 py-1.5 bg-white hover:bg-gray-50"
            download
          >
            ⬇ 下载 Excel
          </a>
        )}
      </div>

      <StoreFilter
        brand={brand}
        brandOptions={brandOptions}
        onBrandChange={setBrand}
        stores={stores}
        store={store}
        onStoreChange={setStore}
        month={month}
        onMonthChange={setMonth}
      />

      {note && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-yellow-700">
          {note}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 mb-4">加载中…</div>}

      {current && snapshot && (
        <KpiCards current={snapshot.current} previous={snapshot.previous} />
      )}

      {trend && trend.months.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <TrendChart title="营业收入趋势 (12月)" trend={trend} metrics={['revenue_amt']} />
          <TrendChart title="营业支出趋势 (12月)" trend={trend} metrics={['expense_amt']} />
          <TrendChart title="毛利 / 净利润趋势" trend={trend} metrics={['gross_profit_amt', 'net_profit_amt']} />
          <TrendChart title="经营现金流趋势" trend={trend} metrics={['operating_cf_amt']} />
          <TrendChart title="银行余额趋势" trend={trend} metrics={['cash_balance']} />
          <TrendChart title="现金流月数趋势" trend={trend} metrics={['cashflow_runway_months']} />
          <TrendChart title="人力占比率趋势" trend={trend} metrics={['hr_ratio_pct']} />
          <TrendChart title="租金占比率趋势" trend={trend} metrics={['rent_ratio_pct']} />
        </div>
      )}

      {!current && !loading && !error && (
        <div className="text-sm text-gray-500 mt-8 text-center">
          请选择门店和月份查看月报
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -10
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/u/store-report/page.tsx
git commit -m "feat(ui): store report main page"
```

---

### Task 14: 顶栏加「报表」菜单

**Files:**
- Modify: `ui/src/app/providers.tsx` (在 NavBar 中新增 dropdown)

- [ ] **Step 1: 在 providers.tsx 顶部 state 区加一个 reportsOpen**

找到：
```typescript
const [financialOpen, setFinancialOpen] = useState(false);
```

在它后面加：
```typescript
const [reportsOpen, setReportsOpen] = useState(false);
```

- [ ] **Step 2: 在 click outside 处理里加入 reportsOpen**

找到：
```typescript
function handleClick() { setAdminOpen(false); setSalesOpen(false); setFinancialOpen(false); }
if (adminOpen || salesOpen || financialOpen) document.addEventListener('click', handleClick);
```

改为：
```typescript
function handleClick() { setAdminOpen(false); setSalesOpen(false); setFinancialOpen(false); setReportsOpen(false); }
if (adminOpen || salesOpen || financialOpen || reportsOpen) document.addEventListener('click', handleClick);
```

- [ ] **Step 3: 在「销售数据」dropdown 之后、「管理」之前插入「报表」dropdown**

找到：
```typescript
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setSalesOpen((v) => !v); }}
                ...
                销售数据 ▼
              </button>
              {salesOpen && (
                <div className="absolute left-0 top-full mt-1 w-36 bg-white border rounded shadow-lg z-50">
                  <Link href="/u/sales" ...>销售报表</Link>
                  <Link href="/u/sales/details" ...>销售明细</Link>
                </div>
              )}
            </div>
```

在 `</div>`（销售数据 dropdown 闭合）之后、`{me?.role === 'admin' && (` 之前，插入：

```typescript
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setReportsOpen((v) => !v); }}
                className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
              >
                报表 ▼
              </button>
              {reportsOpen && (
                <div className="absolute left-0 top-full mt-1 w-36 bg-white border rounded shadow-lg z-50">
                  <Link href="/u/store-report" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">门店月报</Link>
                </div>
              )}
            </div>
```

- [ ] **Step 4: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 5: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/providers.tsx
git commit -m "feat(nav): add 报表 dropdown with 门店月报 link"
```

---

### Task 15: Dashboard 快捷入口补卡

**Files:**
- Modify: `ui/src/app/u/dashboard/page.tsx` (在 快捷入口 section 加新 Link)

- [ ] **Step 1: 找到快捷入口 4 卡片网格**

找到 4 个 `<Link href="/u/...">` 卡片结构（在 `<h3>快捷入口</h3>` 下面），新加第 5 个：

```typescript
        <Link href="/u/store-report" className="block p-3 bg-white border rounded hover:border-blue-400">
          <div className="text-sm font-medium text-blue-600">门店月报</div>
          <div className="text-xs text-gray-500 mt-1">当月快照 + 12月趋势 + Excel</div>
        </Link>
```

将现有 4 卡片的 `grid grid-cols-2` 改为 `grid grid-cols-3`（5 卡分 3 列布局更紧凑）。

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -5
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git add ui/src/app/u/dashboard/page.tsx
git commit -m "feat(dashboard): add 门店月报 quick link card"
```

---

### Task 16: 端到端浏览器验证

**Files:**
- 无（用 Playwright 一次性脚本验证）

- [ ] **Step 1: 启动 dev server**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npm run dev > /tmp/store-report-dev.log 2>&1 &
echo $! > /tmp/store-report-dev.pid
sleep 8
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4100/login
```

预期：HTTP 200。

- [ ] **Step 2: 写 Playwright 验证脚本**

写入 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/ui/_verify_store_report.js`：

```javascript
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:4100/login', { waitUntil: 'domcontentloaded' });
  const inputs = await page.$$('input');
  await inputs[0].fill('preview_admin');
  await inputs[1].fill('preview123');
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  await page.goto('http://localhost:4100/u/store-report', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/store-report-page.png', fullPage: true });
  console.log('page screenshot saved');

  // 验证页面关键元素
  const h1 = await page.$eval('h1', el => el.textContent);
  console.log('h1:', h1);

  const cardCount = await page.$$eval('.grid > div', els => els.length);
  console.log('grid children count:', cardCount);

  // 测试下载
  const store = await page.$('select:nth-of-type(2)');
  const month = await page.$('select:nth-of-type(3)');
  if (store && month) {
    const storeVal = await store.evaluate(el => el.value);
    const monthVal = await month.evaluate(el => el.value);
    console.log('current filter: store=' + storeVal + ', month=' + monthVal);
  }

  await browser.close();
  console.log('OK');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
```

- [ ] **Step 3: 运行验证脚本**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
node _verify_store_report.js
```

预期输出（顺序不严格）：
```
page screenshot saved
h1: 门店月报
grid children count: <某个非零数>
current filter: store=<门店>, month=<月份>
OK
```

- [ ] **Step 4: 检查截图**

```bash
ls -lh /tmp/store-report-page.png
```

预期：文件存在且大小 > 50KB（说明页面有内容渲染）。

- [ ] **Step 5: 测试 Excel 下载**

```bash
# 用 preview_admin session cookie 触发下载
COOKIE=$(curl -s -c - -X POST http://localhost:4100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"preview_admin","password":"preview123"}' | grep wdg_session | awk '{print $7}')
STORE=$(curl -s "http://localhost:4100/api/stores?brand=bonjur" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{const d=JSON.parse(s); console.log(d.data?.[0]?.code ?? '')})")
echo "store=$STORE"
curl -s -o /tmp/store-report.xlsx -w "HTTP %{http_code} | size=%{size_download}\n" \
  -H "Cookie: wdg_session=$COOKIE" \
  "http://localhost:4100/api/store-report/export?brand=bonjur&store=$STORE&month=2026-06"
file /tmp/store-report.xlsx
```

预期：
```
HTTP 200 | size=>5000
/...: Microsoft Excel 2007+
```

- [ ] **Step 6: 验证 Excel 内容**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
node -e "
const XLSX = require('xlsx');
const wb = XLSX.readFile('/tmp/store-report.xlsx');
console.log('sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
  console.log(name + ':', rows.length, 'rows, first row:', JSON.stringify(rows[0]));
}
"
```

预期：4 个 sheet（门店信息 / 当月快照 / 历史趋势 / 同期对比），每个都有数据行。

- [ ] **Step 7: 停 dev server**

```bash
kill $(cat /tmp/store-report-dev.pid) 2>/dev/null
rm -f /tmp/store-report-dev.pid /tmp/store-report-dev.log
```

- [ ] **Step 8: 移除验证脚本**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
rm -f ui/_verify_store_report.js
```

---

### Task 17: 全量构建验证 + 最终清理

**Files:**
- 无（仅验证）

- [ ] **Step 1: TypeScript 编译检查**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx tsc --noEmit 2>&1 | tail -10
```

预期：无错误。

- [ ] **Step 2: Next.js 生产构建**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx next build 2>&1 | tail -20
```

预期：构建成功，无 TypeScript 错误，无 linter 错误。

- [ ] **Step 3: Python 测试**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation
source .venv/bin/activate 2>/dev/null || python3 -m venv .venv && source .venv/bin/activate
pytest tests/ -v 2>&1 | tail -20
```

预期：全绿（本模块不涉及 Python，主要确认现有测试未受影响）。

- [ ] **Step 4: 移除临时 preview 用户**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
node -e "
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const { Client } = require('pg');
const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
(async () => {
  await c.connect();
  const r = await c.query(\"DELETE FROM ops.users WHERE username = 'preview_admin' RETURNING user_id\");
  console.log('removed preview_admin:', r.rowCount);
  await c.end();
})();
"
```

预期：`removed preview_admin: 1`

- [ ] **Step 5: 移除 worktree 中临时 launch.json（如果有）**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
rm -f .claude/launch.json ui/_screenshot.js
git status
```

预期：除 `docs/superpowers/specs/` 已提交文件外没有未提交更改。

- [ ] **Step 6: 最终提交状态确认**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/kind-chandrasekhar-db6d8c
git log --oneline main..HEAD
git diff --stat main..HEAD
```

预期：看到 11-13 个 feat/commit，本地无未提交更改。

---

## 验收 Checklist

- [ ] `feat/store-monthly-report` 分支创建
- [ ] 3 个 brand schema 下都存在 `v_store_monthly_kpi` 视图
- [ ] `/api/store-report/snapshot?brand=X&store=Y&month=YYYY-MM` 返回 200
- [ ] `/api/store-report/trend?brand=X&store=Y&months=12` 返回 200 + 12 月数据
- [ ] `/api/store-report/export` 返回 .xlsx 文件，4 个 sheet
- [ ] `/u/store-report` 页面渲染 9 张 KPI 卡片 + 8 张趋势图
- [ ] 顶栏「报表」菜单可见，下拉有「门店月报」链接
- [ ] Dashboard 快捷入口补 1 张「门店月报」卡
- [ ] `npx tsc --noEmit` 通过
- [ ] `npx next build` 通过
- [ ] `pytest tests/ -v` 全绿
- [ ] preview_admin 测试用户已从 DB 删除
- [ ] 所有临时文件已清理
