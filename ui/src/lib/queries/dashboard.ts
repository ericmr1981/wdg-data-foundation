// Shared server-side query functions for the dashboard module.
// Used by both the RSC page (u/dashboard/page.tsx) and the API routes
// (/api/financial/overview, /api/financial/kpi-trend, /api/financial/qimai-revenue).
// Pure DB access — no auth, no HTTP. Auth is the caller's responsibility.

import pool from '@/lib/db';
import {
  normalizeBrand,
  getDmSchemaSafe,
  getOdsSchema,
  getCfgSchema,
} from '@/lib/brand-server';
import {
  getFinancialOverview,
  getBeginningBalance,
  getActiveStoreCount,
  getKpiRate,
  getOperatingExpenses,
  getKpiTrend,
  getQimaiRevenue,
} from '@/lib/repositories/financial-repository';

const PG_ERR_NO_VIEW = '42P01';

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoreRow {
  store_code: string;
  store_name: string;
}

export interface BrandRow {
  brand_code: string;
  brand_name: string;
}

export interface OverviewData {
  revenue: number;
  expenses: number;
  grossMarginRate: number | null;
  netProfitRate: number | null;
  grossMarginRateQimaiNet: number | null;
  grossMarginRateQimaiGross: number | null;
  qimaiNetRevenue: number | null;
  qimaiGrossRevenue: number | null;
  operatingCashflow: number;
  cashBalance: number;
  cashRunway: number | null;
  storeCount: number;
  revenuePerStore: number;
  ignoreCount: number;
  beginningBalance: number;
  vsPrevPeriod: {
    revenue: number;
    grossMarginRate: number;
    netProfitRate: number;
    operatingCashflow: number;
  };
}

export interface OverviewResult {
  data: OverviewData | null;
  note?: string;
}

export interface MonthlyKpi {
  month: string;
  revenue: number;
  gross_margin_rate: number;
  net_profit_rate: number | null;
  operating_cashflow: number;
  expenses: number;
}

export interface ExpenseItem {
  lvl1_code: string;
  lvl1_name: string;
  lvl2_code: string;
  lvl2_name: string;
  amount: number;
}

export interface TrendData {
  monthly: MonthlyKpi[];
  current_month: {
    revenue: number;
    expenses: ExpenseItem[];
  } | null;
  prev_month: {
    revenue: number;
    expenses: ExpenseItem[];
  } | null;
}

export interface TrendResult {
  data: TrendData | null;
  note?: string;
}

export interface QimaiRevenueData {
  bank_revenue: number;
  qimai_revenue: number | null;
}

export interface QimaiRevenueResult {
  data: QimaiRevenueData | null;
  note?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPrevPeriod(period: string, span: string): string {
  if (span === 'month') {
    const [y, m] = period.split('-');
    const pm = Number(m) - 1;
    return pm < 1 ? `${Number(y) - 1}-12` : `${y}-${String(pm).padStart(2, '0')}`;
  }
  if (span === 'quarter') {
    const [y, q] = period.split('-Q');
    return q === '1' ? `${Number(y) - 1}-Q4` : `${y}-Q${Number(q) - 1}`;
  }
  if (span === 'year') {
    return String(Number(period) - 1);
  }
  return '';
}

/** Parse period string to [startDate, endDate] date strings. */
function parsePeriod(period: string, span: string): [string, string] | null {
  if (span === 'month') {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) return null;
    const [y, m] = period.split('-');
    const nextM = Number(m) + 1;
    return [
      `${period}-01`,
      nextM > 12 ? `${Number(y) + 1}-01-01` : `${y}-${String(nextM).padStart(2, '0')}-01`,
    ];
  }
  if (span === 'quarter') {
    if (!/^\d{4}-Q[1-4]$/.test(period)) return null;
    const [year, q] = period.split('-Q');
    const startM = (Number(q) - 1) * 3 + 1;
    const endM = startM + 3;
    if (endM > 12) {
      return [`${year}-${String(startM).padStart(2, '0')}-01`, `${Number(year) + 1}-01-01`];
    }
    return [`${year}-${String(startM).padStart(2, '0')}-01`, `${year}-${String(endM).padStart(2, '0')}-01`];
  }
  if (span === 'year') {
    if (!/^\d{4}$/.test(period)) return null;
    return [`${period}-01-01`, `${Number(period) + 1}-01-01`];
  }
  return null;
}

// ── Dashboard overview ───────────────────────────────────────────────────────

/**
 * Fetch financial overview data for the dashboard KPI cards.
 * Returns { data: null, note } when the DM view is not ready.
 */
export async function getDashboardOverview(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<OverviewResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };
  if (!['month', 'quarter', 'year'].includes(span)) return { data: null };

  const isAll = period === 'all';

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return { data: null, note: 'view not ready' };
  }

  const odsSchema = getOdsSchema(brand);

  try {
    const [
      overview,
      beginBalanceRes,
      storeCount,
      npRate,
      gmRate,
      expenses,
    ] = await Promise.all([
      getFinancialOverview(dmSchema, odsSchema, period, span, store),
      getBeginningBalance(dmSchema, period, span, store),
      getActiveStoreCount(dmSchema, period, span, store),
      getKpiRate(dmSchema, period, span, store, 'net_profit_rate_pct'),
      getKpiRate(dmSchema, period, span, store, 'gross_profit_rate_pct'),
      getOperatingExpenses(dmSchema, period, span, store),
    ]);

    const pMap = new Map(overview.profit.map((r) => [r.lvl1_code, Number(r.amount)]));
    const revenue = pMap.get('REV_BIZ') || 0;
    const materialCost = pMap.get('MATERIAL') || 0;

    // Gross margin rate: prefer view's cogs-based value, fall back to bank-MATERIAL approx.
    let grossMarginRate: number | null;
    const gmFromView = gmRate;
    if (gmFromView != null) {
      grossMarginRate = gmFromView;
    } else {
      grossMarginRate = revenue > 0 && materialCost < 0 ? (revenue + materialCost) / revenue : null;
    }
    const netProfitRate: number = npRate ?? 0;

    // Qimai-based gross margin
    const cogsTotal: number | null =
      overview.cogs_total != null ? Number(overview.cogs_total) : null;
    const qimaiNet: number | null =
      overview.qimai_net != null ? Number(overview.qimai_net) : null;
    const qimaiGross: number | null =
      overview.qimai_gross != null ? Number(overview.qimai_gross) : null;
    const grossMarginRateQimaiNet: number | null =
      qimaiNet != null && cogsTotal != null && qimaiNet > 0
        ? (qimaiNet - cogsTotal) / qimaiNet
        : null;
    const grossMarginRateQimaiGross: number | null =
      qimaiGross != null && cogsTotal != null && qimaiGross > 0
        ? (qimaiGross - cogsTotal) / qimaiGross
        : null;

    const operatingCashflow = Number(
      overview.cashflow.find((r) => r.activity === 'operating')?.net_amount || 0,
    );
    const cashBalance = Number(overview.balance?.cash_balance || 0);
    const beginningBalance = isAll
      ? 0
      : Number(beginBalanceRes[0]?.cash_balance || 0);

    // Ignore count
    let ignoreCount = 0;
    try {
      const icRes = await pool.query(
        `SELECT count(*) as cnt
         FROM ${dmSchema}.bank_txn_classified_snapshot
         WHERE classified_source = 'ignore'
           ${store !== 'all' ? `AND bank_txn_id IN (SELECT id FROM ${odsSchema}.bank_txn WHERE store_code = $1)` : ''}`,
        store !== 'all' ? [store] : [],
      );
      ignoreCount = Number(icRes.rows[0]?.cnt || 0);
    } catch {
      /* ignore errors in secondary query */
    }

    let cashRunway: number | null = null;
    if (operatingCashflow < 0) {
      const burn = Math.abs(operatingCashflow);
      cashRunway = burn > 0 ? Math.round((cashBalance / burn) * 10) / 10 : null;
    }

    const revenuePerStore =
      storeCount > 0 ? Math.round((revenue / storeCount) * 100) / 100 : 0;

    // Previous period comparison
    let vsRevenue = 0;
    let vsGm = 0;
    let vsNp = 0;
    let vsOcf = 0;
    const prevPeriodStr = isAll ? '' : getPrevPeriod(period, span);

    if (!isAll && prevPeriodStr) {
      const [prevOverview, prevNpRate, prevGmRate] = await Promise.all([
        getFinancialOverview(dmSchema, odsSchema, prevPeriodStr, span, store),
        getKpiRate(dmSchema, prevPeriodStr, span, store, 'net_profit_rate_pct'),
        getKpiRate(dmSchema, prevPeriodStr, span, store, 'gross_profit_rate_pct'),
      ]);

      const prevMap = new Map(
        prevOverview.profit.map((r) => [r.lvl1_code, Number(r.amount)]),
      );
      const prevRev = prevMap.get('REV_BIZ') || 0;
      const prevMat = prevMap.get('MATERIAL') || 0;
      const prevOcf = Number(
        prevOverview.cashflow.find((r) => r.activity === 'operating')?.net_amount || 0,
      );

      vsRevenue = revenue > 0 && prevRev > 0 ? (revenue - prevRev) / prevRev : 0;
      const prevGmRateVal =
        prevGmRate != null
          ? prevGmRate
          : prevRev > 0 && prevMat < 0
            ? (prevRev + prevMat) / prevRev
            : null;
      vsGm =
        grossMarginRate != null && prevGmRateVal != null
          ? grossMarginRate - prevGmRateVal
          : 0;
      vsNp = netProfitRate - (prevNpRate ?? 0);
      vsOcf = prevOcf !== 0 ? (operatingCashflow - prevOcf) / Math.abs(prevOcf) : 0;
    }

    return {
      data: {
        revenue,
        expenses,
        grossMarginRate,
        netProfitRate,
        grossMarginRateQimaiNet,
        grossMarginRateQimaiGross,
        qimaiNetRevenue: qimaiNet,
        qimaiGrossRevenue: qimaiGross,
        operatingCashflow,
        cashBalance,
        cashRunway,
        storeCount,
        revenuePerStore,
        ignoreCount,
        beginningBalance,
        vsPrevPeriod: {
          revenue: vsRevenue,
          grossMarginRate: vsGm,
          netProfitRate: vsNp,
          operatingCashflow: vsOcf,
        },
      },
    };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }
}

// ── Dashboard KPI trend + expense breakdown ──────────────────────────────────

/**
 * Fetch KPI monthly trend + current/prev month expense breakdown.
 * Returns { data: null, note } when the DM view is not ready.
 */
export async function getDashboardTrend(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<TrendResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };

  const isAll = period === 'all';
  const boundaries = isAll ? null : parsePeriod(period, span);
  if (!isAll && !boundaries) return { data: null };

  const startDate = isAll ? null : boundaries![0];
  const endDate = isAll ? null : boundaries![1];

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return { data: null, note: 'view not ready' };
  }

  const odsSchema = dmSchema.replace('_dm', '_ods');
  const cfgSchema = getCfgSchema(brand);
  const storeClause = store !== 'all' ? 'AND t.store_code = $1' : '';
  const storeParams = store !== 'all' ? [store] : [];

  try {
    // ── Monthly trend (last 12 months) ──
    const profitTrend = await getKpiTrend(dmSchema, period, span, store);

    const npTrend = await pool.query(
      `SELECT to_char(month, 'YYYY-MM') as m,
              AVG(net_profit_rate_pct) as rate_pct
         FROM ${dmSchema}.v_store_monthly_kpi
        WHERE month >= (current_date - interval '12 months')::date
          ${store !== 'all' ? 'AND store_code = $1' : ''}
        GROUP BY 1`,
      store !== 'all' ? [store] : [],
    );
    const npTrendMap = new Map<string, number>(
      (npTrend.rows as { m: string; rate_pct: string }[]).map((r) => [
        r.m,
        Number(r.rate_pct) / 100,
      ]),
    );

    const cfTrend = await pool.query(
      `SELECT to_char(date_trunc('month', t.txn_time)::date, 'YYYY-MM') as month,
              COALESCE(SUM(CASE
                WHEN c.lvl1_code IN ('REV_BIZ','HR','MATERIAL','RENT_UTIL','MKT','ADMIN','SHIP','TAX_SURCHARGE','EXP_OTHER')
                  OR (c.lvl1_code = 'REV_OTHER' AND c.lvl2_code IN ('INTEREST_IN','REFUND_IN','TAX_REFUND'))
                THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0)
                ELSE 0
              END), 0) as operating_cashflow
         FROM ${dmSchema}.bank_txn_classified_snapshot c
         JOIN ${odsSchema}.bank_txn t ON t.id = c.bank_txn_id
        WHERE c.classified_source IN ('rule', 'override') ${storeClause}
        GROUP BY date_trunc('month', t.txn_time)::date
        ORDER BY month DESC
        LIMIT 12`,
      storeParams,
    );

    // Build profit map
    const profitMap = new Map<
      string,
      {
        revenue: number;
        revOther: number;
        material: number;
        net: number;
        expenses: number;
        nonCogsExp: number;
      }
    >();
    for (const r of profitTrend) {
      profitMap.set(r.month, {
        revenue: Number(r.revenue_amt),
        revOther: Number(r.rev_other_amt),
        material: Number(r.material_cost_amt),
        net: Number(r.net_profit_amt),
        expenses: Number(r.expense_amt),
        nonCogsExp: Number(r.non_cogs_exp_amt),
      });
    }

    const cfMap = new Map<string, number>();
    for (const r of cfTrend.rows as any[]) {
      cfMap.set(r.month, Number(r.operating_cashflow));
    }

    const allMonths = Array.from(
      new Set([...profitMap.keys(), ...cfMap.keys()]),
    ).sort();
    const monthly: MonthlyKpi[] = allMonths.slice(0, 12).map((m) => {
      const p = profitMap.get(m);
      const cf = cfMap.get(m);
      const rev = p?.revenue || 0;
      const revOther = p?.revOther || 0;

      // Gross margin: bank-MATERIAL approximation
      const grossMarginRate =
        rev > 0 ? (rev + (p?.material || 0)) / rev : 0;

      return {
        month: m,
        revenue: rev,
        gross_margin_rate: grossMarginRate,
        net_profit_rate: npTrendMap.get(m) ?? null,
        operating_cashflow: cf || 0,
        expenses: p?.expenses || 0,
      };
    });

    // ── Expense breakdown for selected period ──
    const expParams: (string | number)[] = [];
    let expDateClause = '';
    if (!isAll && startDate && endDate) {
      expDateClause = ` AND t.txn_time >= $${expParams.length + 1}::date AND t.txn_time < $${expParams.length + 2}::date`;
      expParams.push(startDate, endDate);
    }
    if (store !== 'all') {
      expDateClause += ` AND t.store_code = $${expParams.length + 1}`;
      expParams.push(store);
    }

    const expenseTrend = await pool.query(
      `WITH actuals AS (
        SELECT c.lvl1_code, c.lvl2_code,
               COALESCE(SUM(coalesce(t.out_amt,0) - coalesce(t.in_amt,0)), 0) as amount
          FROM ${dmSchema}.bank_txn_classified_snapshot c
          JOIN ${odsSchema}.bank_txn t ON t.id = c.bank_txn_id
         WHERE c.classified_source IN ('rule', 'override')${expDateClause}
         GROUP BY c.lvl1_code, c.lvl2_code)
      SELECT l1.lvl1_code, l1.lvl1_name,
             l2.lvl2_code, l2d.lvl2_name,
             COALESCE(a.amount, 0) as amount
        FROM (SELECT DISTINCT lvl2_code, lvl1_code
                FROM ${cfgSchema}.dim_category_lvl2
               WHERE lvl1_code IN (SELECT lvl1_code
                                     FROM ${cfgSchema}.dim_category_lvl1
                                    WHERE direction = 'out' AND enabled = true)) l2
        JOIN ${cfgSchema}.dim_category_lvl1 l1 ON l1.lvl1_code = l2.lvl1_code
        JOIN ${cfgSchema}.dim_category_lvl2 l2d ON l2d.lvl1_code = l2.lvl1_code AND l2d.lvl2_code = l2.lvl2_code
        LEFT JOIN actuals a ON a.lvl1_code = l2.lvl1_code AND a.lvl2_code = l2.lvl2_code
       ORDER BY l1.sort_order, l2d.lvl2_code`,
      expParams,
    );

    const currentExpenses: ExpenseItem[] = expenseTrend.rows.map((r: any) => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: r.lvl1_name || r.lvl1_code,
      lvl2_code: r.lvl2_code || '',
      lvl2_name: r.lvl2_name || '',
      amount: Number(r.amount),
    }));

    // Revenue for selected period
    const revRes = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as revenue
         FROM ${dmSchema}.bank_txn_classified_snapshot c
         JOIN ${odsSchema}.bank_txn t ON t.id = c.bank_txn_id
        WHERE c.classified_source IN ('rule', 'override')${expDateClause}`,
      expParams,
    );
    const currentRevenue = Number(revRes.rows[0]?.revenue || 0);

    // ── Previous month expenses ──
    let prevPeriodStr = '';
    if (!isAll && span === 'month') {
      const [y, m] = period.split('-');
      const pm = Number(m) - 1;
      if (pm < 1) prevPeriodStr = `${Number(y) - 1}-12`;
      else prevPeriodStr = `${y}-${String(pm).padStart(2, '0')}`;
    }
    const prevBoundaries = prevPeriodStr
      ? parsePeriod(prevPeriodStr, 'month')
      : null;
    const prevParams: (string | number)[] = [];
    let prevDateClause = '';
    if (prevBoundaries) {
      prevDateClause = ` AND t.txn_time >= $${prevParams.length + 1}::date AND t.txn_time < $${prevParams.length + 2}::date`;
      prevParams.push(prevBoundaries[0], prevBoundaries[1]);
    } else if (!isAll && startDate && endDate) {
      prevDateClause = ` AND t.txn_time >= $${prevParams.length + 1}::date AND t.txn_time < $${prevParams.length + 2}::date`;
      prevParams.push(startDate, endDate);
    }
    if (store !== 'all') {
      prevDateClause += ` AND t.store_code = $${prevParams.length + 1}`;
      prevParams.push(store);
    }

    const prevExpenseTrend = await pool.query(
      `WITH actuals AS (
        SELECT c.lvl1_code, c.lvl2_code,
               COALESCE(SUM(coalesce(t.out_amt,0) - coalesce(t.in_amt,0)), 0) as amount
          FROM ${dmSchema}.bank_txn_classified_snapshot c
          JOIN ${odsSchema}.bank_txn t ON t.id = c.bank_txn_id
         WHERE c.classified_source IN ('rule', 'override')${prevDateClause}
         GROUP BY c.lvl1_code, c.lvl2_code)
      SELECT l1.lvl1_code, l1.lvl1_name,
             l2.lvl2_code, l2d.lvl2_name,
             COALESCE(a.amount, 0) as amount
        FROM (SELECT DISTINCT lvl2_code, lvl1_code
                FROM ${cfgSchema}.dim_category_lvl2
               WHERE lvl1_code IN (SELECT lvl1_code
                                     FROM ${cfgSchema}.dim_category_lvl1
                                    WHERE direction = 'out' AND enabled = true)) l2
        JOIN ${cfgSchema}.dim_category_lvl1 l1 ON l1.lvl1_code = l2.lvl1_code
        JOIN ${cfgSchema}.dim_category_lvl2 l2d ON l2d.lvl1_code = l2.lvl1_code AND l2d.lvl2_code = l2.lvl2_code
        LEFT JOIN actuals a ON a.lvl1_code = l2.lvl1_code AND a.lvl2_code = l2.lvl2_code`,
      prevParams,
    );

    const prevExpenses: ExpenseItem[] = prevExpenseTrend.rows.map((r: any) => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: r.lvl1_name || r.lvl1_code,
      lvl2_code: r.lvl2_code || '',
      lvl2_name: r.lvl2_name || '',
      amount: Number(r.amount),
    }));

    // Previous month revenue
    const prevRevRes = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as revenue
         FROM ${dmSchema}.bank_txn_classified_snapshot c
         JOIN ${odsSchema}.bank_txn t ON t.id = c.bank_txn_id
        WHERE c.classified_source IN ('rule', 'override')${prevDateClause}`,
      prevParams,
    );
    const prevRevenue = Number(prevRevRes.rows[0]?.revenue || 0);

    return {
      data: {
        monthly,
        current_month: isAll
          ? null
          : { revenue: currentRevenue, expenses: currentExpenses },
        prev_month: isAll
          ? null
          : { revenue: prevRevenue, expenses: prevExpenses },
      },
    };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }
}

// ── Qimai revenue (bank entry rate) ──────────────────────────────────────────

/**
 * Fetch cumulative bank revenue and Qimai revenue for the bank-entry-rate card.
 * Returns { data: null, note } when the DM view is not ready.
 */
export async function getDashboardQimaiRevenue(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<QimaiRevenueResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return { data: null, note: 'view not ready' };
  }

  const odsSchema = getOdsSchema(brand);
  const incomeOds = brand === 'gelatomiiix' ? 'gelatomiiix_ods' : odsSchema;

  try {
    const data = await getQimaiRevenue(dmSchema, odsSchema, incomeOds, period, span, store);
    return {
      data: {
        bank_revenue: data.bank_revenue,
        qimai_revenue: data.qimai_revenue,
      },
    };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }
}

// ── Stores ───────────────────────────────────────────────────────────────────

/** Fetch enabled stores for a brand, ordered by sort_order then code. */
export async function getDashboardStores(brand: string): Promise<StoreRow[]> {
  const res = await pool.query(
    `SELECT store_code, store_name
       FROM ops.stores
      WHERE brand_code = $1 AND enabled = true
      ORDER BY sort_order NULLS LAST, store_code`,
    [brand],
  );
  return res.rows;
}

/** Fetch all enabled brands for the selector, ordered by sort_order then code. */
export async function getDashboardBrands(): Promise<BrandRow[]> {
  const res = await pool.query(
    `SELECT brand_code, brand_name
       FROM ops.brands
      WHERE enabled = true
      ORDER BY sort_order NULLS LAST, brand_code`,
  );
  return res.rows;
}
