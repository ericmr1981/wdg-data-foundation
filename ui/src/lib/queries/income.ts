// Shared server-side query functions for the income module.
// Used by both the RSC page (u/income/page.tsx) and the API routes
// (/api/financial/income-metrics, /api/financial/counterparty).
// Pure DB access — no auth, no HTTP. Auth is the caller's responsibility.

import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getCfgSchema, getOdsBankTxnTable } from '@/lib/brand-server';
import { getIncomeMetrics as getRepoIncomeMetrics, getCounterpartyData as getRepoCounterpartyData } from '@/lib/repositories/financial-repository';
import { parsePeriod } from '@/app/api/financial/period-utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface IncomeLvl1 {
  lvl1_code: string;
  lvl1_name: string;
  amount: number;
}

export interface IncomeLvl2 {
  lvl1_code: string;
  lvl1_name: string;
  lvl2_code: string;
  lvl2_name: string;
  amount: number;
}

export interface MonthlyTrendItem {
  month: string;
  amount: number;
}

export interface IncomeMetricsData {
  total_in: number;
  by_lvl1: IncomeLvl1[];
  by_lvl2: IncomeLvl2[];
  monthly_trend: MonthlyTrendItem[];
}

export interface CounterpartySummary {
  counterparty_name: string;
  lvl1_code: string;
  lvl1_name: string;
  total_paid: number;
  total_received?: number;
  txn_count: number;
  first_date: string;
  last_date: string;
}

export interface StoreRow {
  store_code: string;
  store_name: string;
}

// ── Income Metrics ───────────────────────────────────────────────────────────

/**
 * Fetch income metrics: lvl1 + lvl2 breakdown + monthly trend.
 * Throws on unrecoverable errors. Returns null data when DM view is not ready.
 */
export async function getIncomeMetricsData(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<IncomeMetricsData> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) throw new Error('Invalid brand');

  const dmSchema = await getDmSchemaSafe(brand);
  const cfgSchema = getCfgSchema(brand);

  const isAll = period === 'all';
  const boundaries = isAll ? null : parsePeriod(period, span);
  if (!isAll && !boundaries) throw new Error('Invalid period');

  const params: (string | number)[] = [];
  let dateClause = '';
  let storeClause = '';

  if (!isAll && boundaries) {
    dateClause = 'AND month >= $1::date AND month < $2::date';
    params.push(boundaries[0], boundaries[1]);
  }
  if (store !== 'all') {
    storeClause = `AND store_code = $${params.length + 1}`;
    params.push(store);
  }

  // Lvl1 breakdown (from repository)
  const lvl1Result = await getRepoIncomeMetrics(dmSchema, cfgSchema, period, span, store);

  // Lvl2 breakdown
  const lvl2Query = `
    SELECT lvl1_code, lvl2_code, sum(net_amount) as amount
    FROM ${dmSchema}.v_cashflow_statement
    WHERE net_amount > 0 ${dateClause} ${storeClause}
    GROUP BY lvl1_code, lvl2_code
    ORDER BY amount DESC
  `;

  // Dim lookup
  const dimLvl1Query = `SELECT lvl1_code, lvl1_name FROM ${cfgSchema}.dim_category_lvl1`;
  const dimLvl2Query = `SELECT lvl1_code, lvl2_code, lvl2_name FROM ${cfgSchema}.dim_category_lvl2`;

  // Monthly trend (trailing 12 months)
  const trendParams: (string | number)[] = [];
  let trendDateClause = '';
  if (!isAll && boundaries) {
    trendDateClause = 'AND month < $' + (trendParams.length + 1) + '::date';
    trendParams.push(boundaries[1]);
  }
  if (store !== 'all') {
    trendDateClause += ' AND store_code = $' + (trendParams.length + 1);
    trendParams.push(store);
  }
  const trendQuery = `
    SELECT to_char(month, 'YYYY-MM') as month, sum(net_amount) as amount
    FROM ${dmSchema}.v_cashflow_statement
    WHERE net_amount > 0 ${trendDateClause}
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `;

  const [lvl2Res, dimLvl1Res, dimLvl2Res, trendRes] = await Promise.all([
    pool.query(lvl2Query, params),
    pool.query(dimLvl1Query),
    pool.query(dimLvl2Query),
    pool.query(trendQuery, trendParams),
  ]);

  const lvl1NameMap = new Map(
    (dimLvl1Res.rows as { lvl1_code: string; lvl1_name: string }[]).map(
      (r) => [r.lvl1_code, r.lvl1_name],
    ),
  );
  const lvl2NameMap = new Map(
    (dimLvl2Res.rows as { lvl1_code: string; lvl2_code: string; lvl2_name: string }[]).map(
      (r) => [`${r.lvl1_code}:${r.lvl2_code}`, r.lvl2_name],
    ),
  );

  const byLvl1: IncomeLvl1[] = lvl1Result.map((r) => ({
    lvl1_code: r.lvl1_code,
    lvl1_name: lvl1NameMap.get(r.lvl1_code) || r.lvl1_code,
    amount: Number(r.amount),
  }));

  const byLvl2: IncomeLvl2[] = (lvl2Res.rows as { lvl1_code: string; lvl2_code: string; amount: string }[]).map((r) => ({
    lvl1_code: r.lvl1_code,
    lvl1_name: lvl1NameMap.get(r.lvl1_code) || r.lvl1_code,
    lvl2_code: r.lvl2_code,
    lvl2_name: lvl2NameMap.get(`${r.lvl1_code}:${r.lvl2_code}`) || r.lvl2_code,
    amount: Number(r.amount),
  }));

  const totalIn = byLvl1.reduce((s, r) => s + r.amount, 0);

  const monthlyTrend: MonthlyTrendItem[] = (trendRes.rows as { month: string; amount: string }[])
    .map((r) => ({ month: r.month, amount: Number(r.amount) }))
    .reverse();

  return { total_in: totalIn, by_lvl1: byLvl1, by_lvl2: byLvl2, monthly_trend: monthlyTrend };
}

// ── Counterparty List ────────────────────────────────────────────────────────

/**
 * Fetch counterparty list for income (incoming transactions).
 */
export async function getIncomeCounterparties(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
  lvl2Code?: string,
): Promise<CounterpartySummary[]> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) throw new Error('Invalid brand');

  const dmSchema = await getDmSchemaSafe(brand);
  const bankTxnTable = getOdsBankTxnTable(brand);

  return getRepoCounterpartyData(dmSchema, bankTxnTable, period, span, store, 'in', lvl2Code) as unknown as CounterpartySummary[];
}

// ── Stores ───────────────────────────────────────────────────────────────────

/** Fetch enabled stores for a brand, ordered by sort_order then code. */
export async function getStoresForBrand(brand: string): Promise<StoreRow[]> {
  const res = await pool.query(
    `SELECT store_code, store_name
     FROM ops.stores
     WHERE brand_code = $1 AND enabled = true
     ORDER BY sort_order NULLS LAST, store_code`,
    [brand],
  );
  return res.rows.map((r) => ({ store_code: r.store_code, store_name: r.store_name }));
}
