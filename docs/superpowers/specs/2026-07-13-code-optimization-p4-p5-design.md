# Code Optimization — P4, P5 Design

## Overview

Two incremental code optimization phases for wdg-data-foundation, focused on reducing duplicated code. Follows P1-P3 (type safety, module splits, Python import consolidation) completed in the prior cycle.

**Core driver:** Reduce repeated code across 133 API route files.

---

## P4: Eliminate Hardcoded Schema References

**Goal:** Replace 32 routes' hardcoded brand schema names (`bonjur_ods.*`, `gelatomiiix_ods.*`, `brand_tamkoko_*`) with dynamic functions from `brand-server.ts`.

### Analysis

- 133 API routes total
- 48 routes already use dynamic brand resolution (`getDmSchema(brand)`, `getOdsSchema(brand)`, etc.)
- 32 routes still hardcode schema names in SQL strings (verified via grep for `bonjur_ods.`, `gelatomiiix_ods.`, `brand_tamkoko_ods.`, `brand_tamkoko_dm.`)
- `brand-server.ts` already provides: `getOdsSchema()`, `getDmSchema()`, `getCfgSchema()`, `getOpsSchema()`, `normalizeBrand()`, `isAllowedSchema()`
- URL structure unchanged — no frontend/MCP/middleware updates needed

### Changes

For each of the 32 hardcoded routes:

1. Add `import { getOdsSchema, getDmSchema, normalizeBrand } from '@/lib/brand-server'` (if not already imported)
2. Obtain brand code from one of:
   - Query parameter (`?brand=bonjur`) → `normalizeBrand(searchParams.get('brand'))`
   - Route segment (e.g., `/api/bonjur/sales/overview`) → hardcoded constant `'bonjur'` passed to dynamic function
   - Existing constant in the route file
3. Replace hardcoded schema in SQL:
   - `bonjur_ods.income_detail` → `${getOdsSchema(brand)}.income_detail`
   - `gelatomiiix_ods.income_detail` → `${getOdsSchema(brand)}.income_detail`
   - `brand_tamkoko_dm.v_cash_register_overview` → `${getDmSchema(brand)}.v_cash_register_overview`
4. Where brand comes from query param, validate with `normalizeBrand()` before use (SQL injection prevention)

### Hardcoded schema occurrences (by table)

| Hardcoded reference | Count |
|---|---|
| `gelatomiiix_ods.income_detail` | 18 |
| `bonjur_ods.income_detail` | 11 |
| `gelatomiiix_ods.product_sales_detail` | 5 |
| `brand_tamkoko_ods.inventory_monthly_summary` | 4 |
| `bonjur_ods.product_sales_detail` | 4 |
| `brand_tamkoko_dm.v_cash_register_*` | 7 |
| Other (1-2 each) | ~8 |

### Affected routes

Routes with hardcoded schema names (32 total, verified via grep):

**bonjur/ (7 routes):**
- `bonjur/income/bank-entry-stats/route.ts`
- `bonjur/sales/channels/route.ts`
- `bonjur/sales/details/route.ts`
- `bonjur/sales/overview/route.ts`
- `bonjur/sales/products/route.ts`
- `bonjur/sales/qimai-pos/route.ts`
- `bonjur/sales/trend/route.ts`

**gelatomiiix/ (9 routes):**
- `gelatomiiix/income/bank-entry-stats/route.ts`
- `gelatomiiix/income/qimai-detail/route.ts`
- `gelatomiiix/sales/channels/route.ts`
- `gelatomiiix/sales/details/route.ts`
- `gelatomiiix/sales/distribution/route.ts`
- `gelatomiiix/sales/hourly/route.ts`
- `gelatomiiix/sales/overview/route.ts`
- `gelatomiiix/sales/products/route.ts`
- `gelatomiiix/sales/trend/route.ts`

**tamkoko/ (10 routes):**
- `tamkoko/inventory/summary/route.ts`
- `tamkoko/sales/channel/route.ts`
- `tamkoko/sales/combined/route.ts`
- `tamkoko/sales/daily/route.ts`
- `tamkoko/sales/dine-takeaway/route.ts`
- `tamkoko/sales/meal-period/route.ts`
- `tamkoko/sales/multi-store/route.ts`
- `tamkoko/sales/overview/route.ts`
- `tamkoko/sales/trend/route.ts`
- `tamkoko/sales/weekday/route.ts`

**admin/ (3 routes):**
- `admin/analyze-unclassified/route.ts`
- `admin/brands/init-bank-template/route.ts`
- `admin/brands/route.ts`

**income/ (2 routes):**
- `income/meituan-recon/route.ts`
- `income/taobao-recon/route.ts`

**store-report/ (1 route):**
- `store-report/snapshot/route.ts`

### Verification

```bash
cd ui && npx tsc --noEmit
cd .. && python -m pytest tests/ -x -q
```

---

## P5: Repository Layer for High-Duplication Domains

**Goal:** Extract SQL from high-duplication route groups into repository modules, making query logic independently testable and eliminating repeated SQL strings.

### Scope

Only the two domains with the most duplication:

| Domain | Routes | Lines | Main duplication source |
|---|---|---|---|
| **sales** (bonjur + gelatomiiix) | 12 | ~700 | Near-identical SQL, only schema name differs |
| **financial** | 9 | 1,720 | Shared boilerplate (period calc, store filter, auth) |

**Non-goals (kept as-is):**
- admin (35 routes) — SQL all different, no duplication pattern
- rules (9 routes) — already has separate tool modules
- pipeline (3 routes) — too few to justify
- coverage (3 routes) — too few
- tamkoko sales — queries DM-layer views (not ODS tables), structurally different from bonjur/gelato

### P5-A: Sales Repository

**File:** `ui/src/lib/repositories/sales-repository.ts`

**Duplication pattern**: bonjur and gelatomiiix sales routes have near-identical SQL — same columns, same GROUP BY, same WHERE — differing only in schema name. Gelatomiiix adds an optional `pure_mode` filter (excludes rows where `payment_methods` contains `自定义结账方式`).

**Exported functions:**

```typescript
interface SalesQueryOpts {
  pureMode?: boolean;       // gelatomiiix-only: exclude 自定义结账方式
  page?: number;            // for details pagination
  pageSize?: number;
}

getSalesOverview(brand: string, storeCode: string, month: string, opts?: SalesQueryOpts): Promise<OverviewRow>
getSalesTrend(brand: string, storeCode: string, monthRange: [string, string], opts?: SalesQueryOpts): Promise<TrendRow[]>
getSalesByChannel(brand: string, storeCode: string, month: string, opts?: SalesQueryOpts): Promise<ChannelRow[]>
getSalesDetails(brand: string, storeCode: string, month: string, page: number, pageSize: number, opts?: SalesQueryOpts): Promise<{ rows: DetailRow[]; total: number }>
getSalesByProduct(brand: string, storeCode: string, month: string, opts?: SalesQueryOpts): Promise<ProductRow[]>
getSalesByHour(brand: string, storeCode: string, month: string, opts?: SalesQueryOpts): Promise<HourlyRow[]>
getSalesDistribution(brand: string, storeCode: string, month: string): Promise<DistributionRow[]>
```

Each function:
1. Calls `getOdsSchema(brand)` to resolve schema name
2. Builds SQL with template string (schema name is safe — brand passed through `normalizeBrand()` by caller)
3. Appends `pureMode` filter conditionally
4. Executes via `pool.query()` and returns typed rows

**Route layer becomes:**
```typescript
// bonjur/sales/overview/route.ts — 68 lines → ~25 lines
import { getSalesOverview } from '@/lib/repositories/sales-repository';

export async function GET(request: NextRequest) {
  const storeCode = searchParams.get('store_code');
  const month = searchParams.get('month');
  if (!storeCode || !month) return NextResponse.json({ ... }, { status: 400 });
  try {
    const data = await getSalesOverview('bonjur', storeCode, month);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
```

**Affected routes (12):**
- `bonjur/sales/overview`, `bonjur/sales/trend`, `bonjur/sales/channels`, `bonjur/sales/details`, `bonjur/sales/products`
- `gelatomiiix/sales/overview`, `gelatomiiix/sales/trend`, `gelatomiiix/sales/channels`, `gelatomiiix/sales/details`, `gelatomiiix/sales/products`, `gelatomiiix/sales/hourly`, `gelatomiiix/sales/distribution`

**Estimated reduction:** ~400 lines of duplicated SQL

### P5-B: Financial Repository

**File:** `ui/src/lib/repositories/financial-repository.ts`

**Duplication pattern**: 9 financial routes (1,720 lines) already use `${dmSchema}` dynamic resolution. SQL queries are different (different DM views), but they share significant boilerplate:
- Period boundary calculation (`buildPeriodBoundaries`)
- Previous period calculation (`getPrevBoundaries`)
- Store condition building (`buildStoreCondition`)
- Same auth + error handling pattern in every route

**Shared utility functions (extracted to `ui/src/lib/repositories/financial-utils.ts`):**

```typescript
buildStoreCondition(store: string, paramOffset: number): { clause: string; params: unknown[] }
buildPeriodBoundaries(period: string, span: string): { start: string; end: string }
getPrevPeriodBoundaries(period: string, span: string): { start: string; end: string } | null
```

**Exported repository functions:**

```typescript
getFinancialOverview(dmSchema: string, period: string, span: string, store: string): Promise<OverviewData>
getProfitStatement(dmSchema: string, period: string, span: string, store: string): Promise<ProfitRow[]>
getCashflowStatement(dmSchema: string, period: string, span: string, store: string): Promise<CashflowRow[]>
getBalanceSheet(dmSchema: string, period: string, span: string, store: string): Promise<BalanceSheetRow[]>
getKpiTrend(dmSchema: string, period: string, span: string, store: string): Promise<KpiTrendRow[]>
getIncomeMetrics(dmSchema: string, period: string, span: string, store: string): Promise<IncomeMetricsRow[]>
getPaymentMetrics(dmSchema: string, period: string, span: string, store: string): Promise<PaymentMetricsRow[]>
```

**Affected routes (9):**
- `financial/overview`, `financial/profit`, `financial/cashflow`, `financial/balance-sheet`
- `financial/kpi-trend`, `financial/income-metrics`, `financial/payment-metrics`
- `financial/counterparty`, `financial/qimai-revenue`

**Estimated reduction:** ~300 lines of boilerplate

### Verification

```bash
cd ui && npx tsc --noEmit && npm run lint
cd .. && python -m pytest tests/ -x -q
```

---

## Execution Order

1. **P4** — 32 routes, mechanical schema replacement (low risk, high parallelism)
2. **P5-A** — Sales repository + 12 route refactors (highest duplication)
3. **P5-B** — Financial repository + 9 route refactors (boilerplate extraction)

Each phase independently verifiable. P5-A and P5-B do not depend on each other.

---

## Risks

1. **P4 SQL injection** — Schema names cannot be parameterized with `$1` in PostgreSQL; they must be string-interpolated. All brand codes must pass through `normalizeBrand()` (regex `^[a-z][a-z0-9_]{1,31}$`) before interpolation. For routes where brand is a route segment constant (e.g., `'bonjur'`), this is inherently safe.

2. **P5 behavior preservation** — Gelatomiiix-specific logic (pure_mode filter, order_no_clean exclusion, custom结账方式 exclusion) must be preserved via `opts.pureMode` parameter. Unit tests should verify both `pureMode: true` and `pureMode: false` paths.

3. **P5 SQL string interpolation** — Same as P4: schema names interpolated, all values parameterized with `$N`. No user input ever goes into a schema name without `normalizeBrand()` validation.

4. **P5-B function signature complexity** — Financial routes share `period/span/store` params but each has slightly different SQL. Repository functions must accept enough parameters to cover all variants without becoming god-functions. If a function needs >6 params, use an options object.
