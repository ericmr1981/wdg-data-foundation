# Financial Statements (三大报表) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three standard financial statements (利润表, 现金流量表, 资产负债表) to the Next.js UI, starting with gelatomiiix brand data.

**Architecture:** SQL views per-brand dm schema for raw aggregation → 3 dedicated API routes for statement formatting → React components with shared StatementTable for display. Month/quarter/year span handled in API layer via aggregation of monthly data.

**Tech Stack:** PostgreSQL 16 (SQL views), Next.js 14 API Routes, React 18 client components, TailwindCSS, pg.Pool

---

## File Structure

### SQL Layer
- **Create:** `sql/gelatomiiix_financial_statements.sql` — 3 views: `v_profit_statement`, `v_cashflow_statement`, `v_balance_sheet`

### API Layer (3 routes)
- **Create:** `ui/src/app/api/financial/profit/route.ts` — profit statement endpoint
- **Create:** `ui/src/app/api/financial/cashflow/route.ts` — cash flow statement endpoint
- **Create:** `ui/src/app/api/financial/balance-sheet/route.ts` — balance sheet endpoint

### UI Layer (5 files)
- **Create:** `ui/src/app/financial/StatementTable.tsx` — shared financial table component
- **Create:** `ui/src/app/financial/profit/page.tsx` — profit statement tab content
- **Create:** `ui/src/app/financial/cashflow/page.tsx` — cash flow statement tab content
- **Create:** `ui/src/app/financial/balance-sheet/page.tsx` — balance sheet tab content
- **Create:** `ui/src/app/financial/layout.tsx` — page layout with tabs and filters

### Modified Files
- **Modify:** `ui/src/app/providers.tsx` — add "财务报表" nav link

---

### Task 1: Create SQL views for gelatomiiix financial statements

**File:**
- Create: `sql/gelatomiiix_financial_statements.sql`

- [ ] **Define v_profit_statement view**

The view aggregates classified bank transactions by month/store/category, organizing them into income statement sections.

```sql
-- ============================================================
-- gelatomiiix 三大财务报表视图
-- 依赖: gelatomiiix_dm.v_bank_txn_classified_v2
--       gelatomiiix_cfg.dim_category_lvl1 / lvl2
-- 说明: 从已分类银行流水按门店+月份+分类聚合
--       每个 lvl1/lvl2 类别的 amount 取净额（in_amt - out_amt）
--       收入方向为正，支出方向为负
-- ============================================================

-- === 利润表 ===
drop view if exists brand_gelatomiiix_dm.v_profit_statement cascade;

create view brand_gelatomiiix_dm.v_profit_statement as
with classified_txns as (
    select
        t.store_code,
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.in_amt, 0) as in_amt,
        coalesce(t.out_amt, 0) as out_amt
    from brand_gelatomiiix_ods.bank_txn t
    join brand_gelatomiiix_dm.bank_txn_classified_snapshot c on c.bank_txn_id = t.id
    where c.classified_source in ('rule', 'override')
),
category_agg as (
    select
        month,
        store_code,
        lvl1_code,
        lvl2_code,
        sum(in_amt) as total_in,
        sum(out_amt) as total_out,
        count(*) as txn_rows
    from classified_txns
    group by month, store_code, lvl1_code, lvl2_code
)
select
    a.month,
    a.store_code,
    'revenue'::text as section,
    a.lvl1_code,
    l1.lvl1_name,
    a.lvl2_code,
    l2.lvl2_name,
    (a.total_in - a.total_out) as amount,
    a.txn_rows,
    -- sort_order: income items first (positive), then expense items, then net
    case
        when a.lvl1_code = 'REV_BIZ' then 10
        when a.lvl1_code = 'REV_OTHER' then 20
        when a.lvl1_code = 'MATERIAL' then 100
        when a.lvl1_code = 'SHIP' then 110
        when a.lvl1_code = 'HR' then 200
        when a.lvl1_code = 'RENT_UTIL' then 210
        when a.lvl1_code = 'MKT' then 220
        when a.lvl1_code = 'ADMIN' then 230
        when a.lvl1_code = 'BUILD' then 240
        when a.lvl1_code = 'EXP_OTHER' then 250
        else 999
    end as sort_order,
    case
        when a.lvl1_code in ('REV_BIZ', 'REV_OTHER') then 0
        else 1
    end as indent_level
from category_agg a
left join brand_gelatomiiix_cfg.dim_category_lvl1 l1 on l1.lvl1_code = a.lvl1_code
left join brand_gelatomiiix_cfg.dim_category_lvl2 l2 on l2.lvl1_code = a.lvl1_code and l2.lvl2_code = a.lvl2_code;

-- example: select * from brand_gelatomiiix_dm.v_profit_statement where month = '2026-01-01' order by store_code, sort_order;
```

- [ ] **Define v_cashflow_statement view**

Maps classified transactions to operating/investing/financing activities.

```sql
-- === 现金流量表 ===
drop view if exists brand_gelatomiiix_dm.v_cashflow_statement cascade;

create view brand_gelatomiiix_dm.v_cashflow_statement as
with classified_txns as (
    select
        t.store_code,
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.in_amt, 0) as in_amt,
        coalesce(t.out_amt, 0) as out_amt
    from brand_gelatomiiix_ods.bank_txn t
    join brand_gelatomiiix_dm.bank_txn_classified_snapshot c on c.bank_txn_id = t.id
    where c.classified_source in ('rule', 'override')
)
select
    month,
    store_code,
    case
        when lvl1_code = 'REV_BIZ' then 'operating'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'INTEREST_IN' then 'operating'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'REFUND_IN' then 'operating'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'TAX_REFUND' then 'operating'
        when lvl1_code in ('HR', 'MATERIAL', 'RENT_UTIL', 'MKT', 'ADMIN', 'SHIP', 'EXP_OTHER') then 'operating'
        when lvl1_code = 'BUILD' then 'investing'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'INVEST_IN' then 'investing'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'LOAN_IN' then 'financing'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'BORROW_IN' then 'financing'
        when lvl1_code = 'EXP_OTHER' and lvl2_code = 'REPAY' then 'financing'
        else 'operating'
    end as activity,
    lvl1_code,
    lvl2_code,
    sum(in_amt) as total_in,
    sum(out_amt) as total_out,
    sum(in_amt - out_amt) as net_amount,
    count(*) as txn_rows,
    case
        when lvl1_code = 'REV_BIZ' then 10
        when lvl1_code = 'REV_OTHER' and lvl2_code in ('INTEREST_IN', 'REFUND_IN', 'TAX_REFUND') then 20
        when lvl1_code = 'HR' then 110
        when lvl1_code = 'MATERIAL' then 120
        when lvl1_code = 'RENT_UTIL' then 130
        when lvl1_code = 'MKT' then 140
        when lvl1_code = 'ADMIN' then 150
        when lvl1_code = 'SHIP' then 160
        when lvl1_code = 'EXP_OTHER' and lvl2_code = 'TAX' then 170
        when lvl1_code = 'EXP_OTHER' then 180
        when lvl1_code = 'BUILD' then 210
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'INVEST_IN' then 220
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'LOAN_IN' then 310
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'BORROW_IN' then 320
        when lvl1_code = 'EXP_OTHER' and lvl2_code = 'REPAY' then 330
        else 999
    end as sort_order
from classified_txns
group by month, store_code, lvl1_code, lvl2_code;

-- example: select * from brand_gelatomiiix_dm.v_cashflow_statement where month = '2026-01-01' order by store_code, sort_order;
```

- [ ] **Define v_balance_sheet view**

Cumulative from inception (zero starting balance). Each month-end row shows running totals.

```sql
-- === 资产负债表 ===
-- 从 0 开始累计，每月末时点快照
drop view if exists brand_gelatomiiix_dm.v_balance_sheet cascade;

create view brand_gelatomiiix_dm.v_balance_sheet as
with monthly_net as (
    select
        date_trunc('month', t.txn_time)::date as month,
        store_code,
        sum(coalesce(in_amt, 0)) as total_in,
        sum(coalesce(out_amt, 0)) as total_out,
        sum(coalesce(in_amt, 0) - coalesce(out_amt, 0)) as net_cashflow
    from brand_gelatomiiix_ods.bank_txn t
    group by date_trunc('month', t.txn_time)::date, store_code
),
classified_txns as (
    select
        t.store_code,
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.in_amt, 0) as in_amt,
        coalesce(t.out_amt, 0) as out_amt
    from brand_gelatomiiix_ods.bank_txn t
    join brand_gelatomiiix_dm.bank_txn_classified_snapshot c on c.bank_txn_id = t.id
    where c.classified_source in ('rule', 'override')
),
cumulative as (
    select
        month,
        store_code,
        sum(net_cashflow) over (partition by store_code order by month) as cash_balance
    from monthly_net
),
loans_received as (
    select
        month,
        store_code,
        sum(in_amt) as total_loan
    from classified_txns
    where (lvl1_code = 'REV_OTHER' and lvl2_code in ('LOAN_IN', 'BORROW_IN'))
    group by month, store_code
),
loans_repaid as (
    select
        month,
        store_code,
        sum(out_amt) as total_repay
    from classified_txns
    where (lvl1_code = 'EXP_OTHER' and lvl2_code = 'REPAY')
    group by month, store_code
),
capital_invested as (
    select
        month,
        store_code,
        sum(in_amt) as total_capital
    from classified_txns
    where (lvl1_code = 'REV_OTHER' and lvl2_code = 'INVEST_IN')
    group by month, store_code
),
cumulative_items as (
    select
        c.month,
        c.store_code,
        c.cash_balance,
        coalesce(sum(l.total_loan) over (partition by c.store_code order by c.month), 0) as cum_loan,
        coalesce(sum(r.total_repay) over (partition by c.store_code order by c.month), 0) as cum_repay,
        coalesce(sum(cap.total_capital) over (partition by c.store_code order by c.month), 0) as cum_capital
    from cumulative c
    left join loans_received l on l.month = c.month and l.store_code = c.store_code
    left join loans_repaid r on r.month = c.month and r.store_code = c.store_code
    left join capital_invested cap on cap.month = c.month and cap.store_code = c.store_code
)
select
    month,
    store_code,
    cash_balance,
    (cum_loan - cum_repay) as loan_balance,
    cum_capital as capital_balance,
    0 as retained_earnings  -- placeholder: will be computed from profit statement
from cumulative_items
order by store_code, month;

-- example: select * from brand_gelatomiiix_dm.v_balance_sheet where month = '2026-02-01';
```

- [ ] **Verify views work on VPS database**

Run: `export $(grep -v '^#' .env | xargs) && psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f sql/gelatomiiix_financial_statements.sql`

Then verify: `python3 -c "import psycopg2; conn = psycopg2.connect(host='$DB_HOST',port=$DB_PORT,dbname='$DB_NAME',user='$DB_USER',password='$DB_PASSWORD'); cur = conn.cursor(); cur.execute('SELECT count(*) FROM brand_gelatomiiix_dm.v_profit_statement'); print(f'v_profit_statement: {cur.fetchone()[0]} rows'); cur.execute('SELECT count(*) FROM brand_gelatomiiix_dm.v_cashflow_statement'); print(f'v_cashflow_statement: {cur.fetchone()[0]} rows'); cur.execute('SELECT count(*) FROM brand_gelatomiiix_dm.v_balance_sheet'); print(f'v_balance_sheet: {cur.fetchone()[0]} rows')"`

Expected: All 3 views return rows without error.

- [ ] **Commit**

```bash
git add sql/gelatomiiix_financial_statements.sql
git commit -m "feat(financial): add gelatomiiix financial statement SQL views"
```

---

### Task 2: Create profit statement API route

**Files:**
- Create: `ui/src/app/api/financial/profit/route.ts`

- [ ] **Create profit API route**

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getCfgSchema, getDmSchemaSafe, getOdsBankTxnTable, getSchemaPrefix } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

function buildProfitLines(raw: { section: string; lvl1_code: string; lvl1_name: string; lvl2_name: string; amount: string; indent_level: number }[]): LineItem[] {
  const lines: LineItem[] = [];

  // Separate revenue, cost, and expense items
  const revenue = raw.filter(r => r.section === 'revenue' && r.lvl1_code === 'REV_BIZ');
  const otherIncome = raw.filter(r => r.section === 'revenue' && r.lvl1_code === 'REV_OTHER');
  const material = raw.filter(r => r.lvl1_code === 'MATERIAL');
  const shipping = raw.filter(r => r.lvl1_code === 'SHIP');
  const hr = raw.filter(r => r.lvl1_code === 'HR');
  const rentUtil = raw.filter(r => r.lvl1_code === 'RENT_UTIL');
  const mkt = raw.filter(r => r.lvl1_code === 'MKT');
  const admin = raw.filter(r => r.lvl1_code === 'ADMIN');
  const build = raw.filter(r => r.lvl1_code === 'BUILD');
  const expOther = raw.filter(r => r.lvl1_code === 'EXP_OTHER');
  const otherExpense = [...hr, ...rentUtil, ...mkt, ...admin, ...build, ...expOther];

  const sumAmount = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);

  const revenueAmt = sumAmount(revenue);
  const otherIncomeAmt = sumAmount(otherIncome);
  const costAmt = sumAmount(material) + sumAmount(shipping);
  const totalExpenseAmt = sumAmount(otherExpense);

  // --- Section 1: Revenue ---
  lines.push({ section: 'revenue', label: '一、营业收入', amount: revenueAmt, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of revenue) {
    lines.push({ section: 'revenue_detail', label: `  ${r.lvl2_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (otherIncome.length > 0) {
    lines.push({ section: 'revenue', label: '二、其他收入', amount: otherIncomeAmt, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of otherIncome) {
      lines.push({ section: 'revenue_detail', label: `  ${r.lvl2_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
    }
  }
  lines.push({ section: 'revenue', label: '收入合计', amount: revenueAmt + otherIncomeAmt, indent: 0, is_subtotal: true, is_highlight: false });

  // --- Section 2: Cost ---
  lines.push({ section: 'cost', label: '三、营业成本', amount: costAmt, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of material) {
    lines.push({ section: 'cost_detail', label: `  材料采购 - ${r.lvl2_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
  }
  for (const r of shipping) {
    lines.push({ section: 'cost_detail', label: `  运费 - ${r.lvl2_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'cost', label: '营业成本合计', amount: costAmt, indent: 0, is_subtotal: true, is_highlight: false });

  // --- Gross Profit ---
  const grossProfit = (revenueAmt + otherIncomeAmt) - costAmt;
  lines.push({ section: 'gross_profit', label: '毛利', amount: grossProfit, indent: 0, is_subtotal: false, is_highlight: true });

  // --- Section 3: Period Expenses ---
  lines.push({ section: 'expense', label: '四、期间费用', amount: totalExpenseAmt, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of otherExpense) {
    lines.push({ section: 'expense_detail', label: `  ${r.lvl1_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'expense', label: '期间费用合计', amount: totalExpenseAmt, indent: 0, is_subtotal: true, is_highlight: false });

  // --- Net Profit ---
  const netProfit = grossProfit - totalExpenseAmt;
  const netProfitLabel = netProfit >= 0 ? '净利润' : '净亏损';
  lines.push({ section: 'net_profit', label: `五、${netProfitLabel}`, amount: netProfit, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

// GET /api/financial/profit?brand=gelatomiiix&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const period = searchParams.get('period') || '';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const dmSchema = await getDmSchemaSafe(brand);
    const viewName = `${dmSchema}.v_profit_statement`;

    // Build WHERE clause based on span
    let monthFilter: string;
    if (span === 'month') {
      monthFilter = `date_trunc('month', month) = '${period}-01'::date`;
    } else if (span === 'quarter') {
      // period format: 2026-Q1 → extract year and quarter
      const [year, q] = period.split('-Q');
      const startMonth = (Number(q) - 1) * 3 + 1;
      monthFilter = `month >= '${year}-${String(startMonth).padStart(2, '0')}-01'::date AND month < '${year}-${String(startMonth + 3).padStart(2, '0')}-01'::date`;
    } else if (span === 'year') {
      monthFilter = `month >= '${period}-01-01'::date AND month < '${Number(period) + 1}-01-01'::date`;
    } else {
      return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
    }

    const storeFilter = store !== 'all' ? `AND store_code = '${store.replace(/'/g, "''")}'` : '';

    const query = `
      SELECT section, lvl1_code, lvl1_name, lvl2_name,
             sum(amount) as amount,
             min(indent_level) as indent_level
      FROM ${viewName}
      WHERE ${monthFilter} ${storeFilter}
      GROUP BY section, lvl1_code, lvl1_name, lvl2_name
      ORDER BY min(sort_order), lvl1_code, lvl2_code
    `;

    const result = await pool.query(query);
    const lines = buildProfitLines(result.rows);

    return NextResponse.json({
      success: true,
      data: {
        brand,
        period,
        span,
        store,
        lines
      }
    });

  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    const status = error?.status || 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to load profit statement' }, { status });
  }
}
```

- [ ] **Create profit statement API route**

Write the above code to `ui/src/app/api/financial/profit/route.ts`.

- [ ] **Commit**

```bash
git add ui/src/app/api/financial/profit/route.ts
git commit -m "feat(api): add profit statement API endpoint"
```

---

### Task 3: Create cash flow statement API route

**Files:**
- Create: `ui/src/app/api/financial/cashflow/route.ts`

- [ ] **Create cash flow API route**

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

interface CashflowRow {
  activity: string;
  lvl1_code: string;
  lvl2_code: string;
  total_in: string;
  total_out: string;
  net_amount: string;
}

function buildCashflowLines(raw: CashflowRow[]): LineItem[] {
  const lines: LineItem[] = [];
  const operating = raw.filter(r => r.activity === 'operating');
  const investing = raw.filter(r => r.activity === 'investing');
  const financing = raw.filter(r => r.activity === 'financing');

  const toNum = (v: string) => Number(v);

  // Operating inflows
  const opInflows = operating.filter(r => toNum(r.net_amount) > 0);
  const opOutflows = operating.filter(r => toNum(r.net_amount) < 0);
  const opInflowTotal = opInflows.reduce((s, r) => s + toNum(r.total_in), 0);
  const opOutflowTotal = opOutflows.reduce((s, r) => s + toNum(r.total_out), 0);
  const opNet = opInflowTotal - opOutflowTotal;

  lines.push({ section: 'operating_header', label: '一、经营活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of opInflows) {
    lines.push({ section: 'operating_in_detail', label: `  ${r.lvl1_code === 'REV_BIZ' ? '销售商品收到的现金' : r.lvl1_code + '/' + (r.lvl2_code || '')}`, amount: toNum(r.total_in), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (opInflows.length > 0) {
    lines.push({ section: 'operating_in', label: '  经营活动现金流入小计', amount: opInflowTotal, indent: 1, is_subtotal: true, is_highlight: false });
  }
  for (const r of opOutflows) {
    lines.push({ section: 'operating_out_detail', label: `  ${r.lvl1_code === 'HR' ? '支付给职工的现金' : r.lvl1_code === 'MATERIAL' ? '购买商品支付的现金' : r.lvl1_code === 'TAX' || (r.lvl1_code === 'EXP_OTHER' && r.lvl2_code === 'TAX') ? '支付的各项税费' : r.lvl1_code}`, amount: -toNum(r.total_out), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (opOutflows.length > 0) {
    lines.push({ section: 'operating_out', label: '  经营活动现金流出小计', amount: -opOutflowTotal, indent: 1, is_subtotal: true, is_highlight: false });
  }
  lines.push({ section: 'operating_net', label: '经营活动产生的现金流量净额', amount: opNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Investing
  const invInflowTotal = investing.filter(r => toNum(r.net_amount) > 0).reduce((s, r) => s + toNum(r.total_in), 0);
  const invOutflowTotal = investing.filter(r => toNum(r.net_amount) < 0).reduce((s, r) => s + toNum(r.total_out), 0);
  const invNet = invInflowTotal - invOutflowTotal;

  lines.push({ section: 'investing_header', label: '二、投资活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of investing) {
    const amt = toNum(r.net_amount);
    lines.push({ section: 'investing_detail', label: `  ${r.lvl1_code === 'BUILD' ? '购建固定资产支付的现金' : r.lvl1_code + '/' + (r.lvl2_code || '')}`, amount: amt, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'investing_net', label: '投资活动产生的现金流量净额', amount: invNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Financing
  const finInflowTotal = financing.filter(r => toNum(r.net_amount) > 0).reduce((s, r) => s + toNum(r.total_in), 0);
  const finOutflowTotal = financing.filter(r => toNum(r.net_amount) < 0).reduce((s, r) => s + toNum(r.total_out), 0);
  const finNet = finInflowTotal - finOutflowTotal;

  lines.push({ section: 'financing_header', label: '三、筹资活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of financing) {
    const amt = toNum(r.net_amount);
    lines.push({ section: 'financing_detail', label: `  ${r.lvl2_code === 'LOAN_IN' ? '取得借款收到的现金' : r.lvl2_code === 'BORROW_IN' ? '收到借款' : r.lvl2_code === 'REPAY' ? '偿还债务支付的现金' : r.lvl2_code || r.lvl1_code}`, amount: amt, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'financing_net', label: '筹资活动产生的现金流量净额', amount: finNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Net increase
  const totalNet = opNet + invNet + finNet;
  lines.push({ section: 'total_net', label: '四、现金净增加额', amount: totalNet, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

// GET /api/financial/cashflow?brand=gelatomiiix&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const period = searchParams.get('period') || '';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const dmSchema = await getDmSchemaSafe(brand);
    const viewName = `${dmSchema}.v_cashflow_statement`;

    let monthFilter: string;
    if (span === 'month') {
      monthFilter = `date_trunc('month', month) = '${period}-01'::date`;
    } else if (span === 'quarter') {
      const [year, q] = period.split('-Q');
      const startMonth = (Number(q) - 1) * 3 + 1;
      monthFilter = `month >= '${year}-${String(startMonth).padStart(2, '0')}-01'::date AND month < '${year}-${String(startMonth + 3).padStart(2, '0')}-01'::date`;
    } else if (span === 'year') {
      monthFilter = `month >= '${period}-01-01'::date AND month < '${Number(period) + 1}-01-01'::date`;
    } else {
      return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
    }

    const storeFilter = store !== 'all' ? `AND store_code = '${store.replace(/'/g, "''")}'` : '';

    const query = `
      SELECT activity, lvl1_code, lvl2_code,
             sum(total_in) as total_in,
             sum(total_out) as total_out,
             sum(net_amount) as net_amount
      FROM ${viewName}
      WHERE ${monthFilter} ${storeFilter}
      GROUP BY activity, lvl1_code, lvl2_code
      ORDER BY min(sort_order)
    `;

    const result = await pool.query(query);
    const lines = buildCashflowLines(result.rows);

    return NextResponse.json({
      success: true,
      data: { brand, period, span, store, lines }
    });

  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    const status = error?.status || 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to load cashflow statement' }, { status });
  }
}
```

- [ ] **Create cash flow API route**

Write the above code to `ui/src/app/api/financial/cashflow/route.ts`.

- [ ] **Commit**

```bash
git add ui/src/app/api/financial/cashflow/route.ts
git commit -m "feat(api): add cash flow statement API endpoint"
```

---

### Task 4: Create balance sheet API route

**Files:**
- Create: `ui/src/app/api/financial/balance-sheet/route.ts`

- [ ] **Create balance sheet API route**

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

interface BalanceRow {
  month: string;
  store_code: string;
  cash_balance: string;
  loan_balance: string;
  capital_balance: string;
  retained_earnings: string;
}

function buildBalanceLines(raw: BalanceRow[]): LineItem[] {
  if (raw.length === 0) return [];

  // Take latest month for balance sheet (snapshot)
  const r = raw[raw.length - 1];
  const cash = Number(r.cash_balance);
  const loans = Number(r.loan_balance);
  const capital = Number(r.capital_balance);
  const retained = Number(r.retained_earnings);
  const totalAssets = cash;
  const totalLiabilities = loans;
  const totalEquity = capital + retained;
  const lines: LineItem[] = [];

  // Assets
  lines.push({ section: 'asset_header', label: '资产', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'asset_detail', label: '  货币资金', amount: cash, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'asset_total', label: '资产总计', amount: totalAssets, indent: 0, is_subtotal: true, is_highlight: true });

  // Liabilities
  lines.push({ section: 'liability_header', label: '负债', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'liability_detail', label: '  借款', amount: loans, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'liability_total', label: '负债总计', amount: totalLiabilities, indent: 0, is_subtotal: true, is_highlight: true });

  // Equity
  lines.push({ section: 'equity_header', label: '所有者权益', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_detail', label: '  实收资本', amount: capital, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_detail', label: '  未分配利润', amount: retained, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_total', label: '所有者权益总计', amount: totalEquity, indent: 0, is_subtotal: true, is_highlight: true });

  // Total
  lines.push({ section: 'total', label: '负债和所有者权益总计', amount: totalLiabilities + totalEquity, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

// GET /api/financial/balance-sheet?brand=gelatomiiix&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const period = searchParams.get('period') || '';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const dmSchema = await getDmSchemaSafe(brand);
    const viewName = `${dmSchema}.v_balance_sheet`;
    const profitView = `${dmSchema}.v_profit_statement`;

    let monthFilter: string;
    let targetMonth: string;
    if (span === 'month') {
      targetMonth = `${period}-01`;
      monthFilter = `month = '${targetMonth}'::date`;
    } else if (span === 'quarter') {
      const [year, q] = period.split('-Q');
      const endMonth = Number(q) * 3;
      targetMonth = `${year}-${String(endMonth).padStart(2, '0')}-01`;
      monthFilter = `month = '${targetMonth}'::date`;
    } else if (span === 'year') {
      targetMonth = `${period}-12-01`;
      monthFilter = `month = '${targetMonth}'::date`;
    } else {
      return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
    }

    const storeClause = store !== 'all' ? `store_code = '${store.replace(/'/g, "''")}'` : '';
    const balanceStoreFilter = storeClause ? `AND ${storeClause}` : '';

    // Balance sheet: cumulative up to the target month
    const balanceQuery = `
      SELECT month, store_code, cash_balance, loan_balance, capital_balance, retained_earnings
      FROM ${viewName}
      WHERE ${monthFilter} ${balanceStoreFilter}
      ORDER BY store_code, month
    `;

    // Retained earnings = cumulative net profit up to target month
    // v_profit_statement.amount is in_amt - out_amt, so sum gives net profit
    const profitQuery = `
      SELECT store_code, sum(amount) as retained_earnings
      FROM ${profitView}
      WHERE month <= '${targetMonth}'::date ${storeClause ? `AND ${storeClause}` : ''}
      GROUP BY store_code
    `;

    const [balanceRes, profitRes] = await Promise.all([
      pool.query(balanceQuery),
      pool.query(profitQuery)
    ]);

    // Merge retained earnings into balance data
    const profitMap = new Map(profitRes.rows.map(r => [r.store_code, Number(r.retained_earnings)]));
    const merged = balanceRes.rows.map(r => ({
      ...r,
      retained_earnings: profitMap.get(r.store_code) || 0
    }));

    const lines = buildBalanceLines(merged);

    return NextResponse.json({
      success: true,
      data: { brand, period, span, store, lines }
    });

  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    const status = error?.status || 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to load balance sheet' }, { status });
  }
}
```

- [ ] **Create balance sheet API route**

Write the above code to `ui/src/app/api/financial/balance-sheet/route.ts`.

- [ ] **Commit**

```bash
git add ui/src/app/api/financial/balance-sheet/route.ts
git commit -m "feat(api): add balance sheet API endpoint"
```

---

### Task 5: Create StatementTable shared component

**Files:**
- Create: `ui/src/app/financial/StatementTable.tsx`

- [ ] **Create StatementTable component**

```typescript
'use client';

export interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

interface StatementTableProps {
  lines: LineItem[];
}

export default function StatementTable({ lines }: StatementTableProps) {
  const formatAmount = (amount: number) => {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount < 0 ? `(${formatted})` : formatted;
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3">项目</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">金额</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {lines.map((line, idx) => (
            <tr
              key={idx}
              className={`
                ${line.is_highlight ? 'bg-blue-50 font-bold' : ''}
                ${line.is_subtotal ? 'font-semibold' : ''}
                hover:bg-gray-50 transition-colors
              `}
            >
              <td
                className={`
                  px-4 py-2.5 text-sm whitespace-nowrap
                  ${line.indent > 0 ? 'pl-8' : ''}
                  ${line.is_highlight ? 'text-blue-900' : 'text-gray-900'}
                `}
              >
                {line.label}
              </td>
              <td className={`px-4 py-2.5 text-sm whitespace-nowrap text-right ${line.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {line.is_highlight || line.is_subtotal ? formatAmount(line.amount) : line.indent > 0 ? formatAmount(line.amount) : formatAmount(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Create StatementTable**

Write the above code to `ui/src/app/financial/StatementTable.tsx`.

- [ ] **Commit**

```bash
git add ui/src/app/financial/StatementTable.tsx
git commit -m "feat(ui): add shared StatementTable component"
```

---

### Task 6: Create 3 statement tab page components

**Files:**
- Create: `ui/src/app/financial/profit/page.tsx`
- Create: `ui/src/app/financial/cashflow/page.tsx`
- Create: `ui/src/app/financial/balance-sheet/page.tsx`

- [ ] **Create profit statement tab page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import StatementTable, { LineItem } from '../StatementTable';

interface ProfitProps {
  brand: string;
  period: string;
  span: string;
  store: string;
}

export default function ProfitStatement({ brand, period, span, store }: ProfitProps) {
  const [lines, setLines] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/financial/profit?brand=${brand}&period=${period}&span=${span}&store=${store}`
        );
        const json = await res.json();
        if (json.success) {
          setLines(json.data?.lines || []);
        } else {
          setError(json.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [brand, period, span, store]);

  if (loading) return <div className="flex justify-center py-12 text-gray-500">加载中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">错误: {error}</div>;
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;

  return <StatementTable lines={lines} />;
}
```

Write to `ui/src/app/financial/profit/page.tsx`.

- [ ] **Create cash flow statement tab page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import StatementTable, { LineItem } from '../StatementTable';

interface CashflowProps {
  brand: string;
  period: string;
  span: string;
  store: string;
}

export default function CashflowStatement({ brand, period, span, store }: CashflowProps) {
  const [lines, setLines] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/financial/cashflow?brand=${brand}&period=${period}&span=${span}&store=${store}`
        );
        const json = await res.json();
        if (json.success) {
          setLines(json.data?.lines || []);
        } else {
          setError(json.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [brand, period, span, store]);

  if (loading) return <div className="flex justify-center py-12 text-gray-500">加载中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">错误: {error}</div>;
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;

  return <StatementTable lines={lines} />;
}
```

Write to `ui/src/app/financial/cashflow/page.tsx`.

- [ ] **Create balance sheet tab page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import StatementTable, { LineItem } from '../StatementTable';

interface BalanceSheetProps {
  brand: string;
  period: string;
  span: string;
  store: string;
}

export default function BalanceSheet({ brand, period, span, store }: BalanceSheetProps) {
  const [lines, setLines] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/financial/balance-sheet?brand=${brand}&period=${period}&span=${span}&store=${store}`
        );
        const json = await res.json();
        if (json.success) {
          setLines(json.data?.lines || []);
        } else {
          setError(json.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [brand, period, span, store]);

  if (loading) return <div className="flex justify-center py-12 text-gray-500">加载中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">错误: {error}</div>;
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;

  return <StatementTable lines={lines} />;
}
```

Write to `ui/src/app/financial/balance-sheet/page.tsx`.

- [ ] **Commit**

```bash
git add ui/src/app/financial/profit/page.tsx ui/src/app/financial/cashflow/page.tsx ui/src/app/financial/balance-sheet/page.tsx
git commit -m "feat(ui): add financial statement tab page components"
```

---

### Task 7: Create financial page layout with filters and tabs

**Files:**
- Create: `ui/src/app/financial/layout.tsx`

- [ ] **Create financial page layout**

```typescript
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';
import ProfitStatement from './profit/page';
import CashflowStatement from './cashflow/page';
import BalanceSheet from './balance-sheet/page';

type TabId = 'profit' | 'cashflow' | 'balance-sheet';
type SpanId = 'month' | 'quarter' | 'year';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profit', label: '利润表' },
  { id: 'cashflow', label: '现金流量表' },
  { id: 'balance-sheet', label: '资产负债表' },
];

function useStores(brand: string) {
  const [stores, setStores] = useState<string[]>([]);
  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setStores(json.data.map((s: any) => s.store_code));
        }
      })
      .catch(() => {});
  }, [brand]);
  return stores;
}

export default function FinancialLayout() {
  const { brand } = useBrand();
  const [activeTab, setActiveTab] = useState<TabId>('profit');
  const [span, setSpan] = useState<SpanId>('month');
  const [period, setPeriod] = useState('2026-01');
  const [store, setStore] = useState('all');

  // Generate period options based on span
  const periodOptions = useMemo(() => {
    if (span === 'month') {
      return ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
    }
    if (span === 'quarter') {
      return ['2025-Q3', '2025-Q4', '2026-Q1'];
    }
    return ['2025', '2026'];
  }, [span]);

  // Update period when span changes
  useEffect(() => {
    setPeriod(periodOptions[periodOptions.length - 1] || '2026-01');
  }, [span, periodOptions]);

  const stores = useStores(brand);

  const renderStatement = () => {
    const props = { brand, period, span, store };
    switch (activeTab) {
      case 'profit': return <ProfitStatement {...props} />;
      case 'cashflow': return <CashflowStatement {...props} />;
      case 'balance-sheet': return <BalanceSheet {...props} />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">跨度:</label>
          <select
            value={span}
            onChange={e => setSpan(e.target.value as SpanId)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="month">月</option>
            <option value="quarter">季度</option>
            <option value="year">年</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">期间:</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            {periodOptions.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">门店:</label>
          <select
            value={store}
            onChange={e => setStore(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="all">全部</option>
            {stores.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                pb-2 px-1 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Statement content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {renderStatement()}
      </div>
    </div>
  );
}
```

- [ ] **Create financial page layout**

Write the above code to `ui/src/app/financial/layout.tsx`.

Note: The `useMonths` hook above fetches store data; period options are hardcoded for gelatomiiix sample phase. This can be made dynamic later by adding a `/api/financial/months` endpoint.

- [ ] **Commit**

```bash
git add ui/src/app/financial/layout.tsx
git commit -m "feat(ui): add financial page layout with filters and tabs"
```

---

### Task 8: Add navigation link and verify

**Files:**
- Modify: `ui/src/app/providers.tsx`

- [ ] **Add "财务报表" nav link**

In `ui/src/app/providers.tsx`, find the existing nav links and add a new "财务报表" link between "文件上传" and the admin config link:

```typescript
// After the Upload link, add:
<Link href="/financial" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
  财务报表
</Link>
```

- [ ] **Verify the app builds**

Run: `cd ui && npx next build 2>&1 | tail -20`

Expected: Build succeeds with no errors.

- [ ] **Commit**

```bash
git add ui/src/app/providers.tsx
git commit -m "feat(ui): add financial statement nav link"
```
