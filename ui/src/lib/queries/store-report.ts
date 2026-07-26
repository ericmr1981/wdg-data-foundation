// Shared server-side query functions for the store-report module.
// Used by both the RSC page (u/store-report/page.tsx) and the API routes
// (api/store-report/snapshot + trend). Pure DB access — no auth, no HTTP.
// Auth is the caller's responsibility (getSessionUser in API route / RSC).

import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getDmSchema } from '@/lib/brand-server';
import type { SnapshotResponse, StoreKpi, TrendResponse, KpiMetricKey } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

// Trend uses a wider metric set than KpiMetricKey (includes cost_amt / hr_amt /
// rent_amt / loan_balance). The TrendResponse type is intentionally looser.
type TrendSeriesKey =
  | KpiMetricKey
  | 'cost_amt' | 'hr_amt' | 'rent_amt' | 'loan_balance';

const TREND_SERIES_KEYS: TrendSeriesKey[] = [
  'revenue_amt', 'cost_amt', 'expense_amt', 'hr_amt', 'rent_amt',
  'gross_profit_amt', 'gross_profit_rate_pct',
  'net_profit_amt', 'net_profit_rate_pct',
  'operating_cf_amt', 'cash_balance', 'loan_balance', 'cashflow_runway_months',
  'hr_ratio_pct', 'rent_ratio_pct',
];

export interface SnapshotQueryResult {
  data: SnapshotResponse | null;
  note?: string;
}

function toKpi(r: any): StoreKpi {
  return {
    month: r.month instanceof Date
      ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}`
      : String(r.month),
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
    gross_profit_rate_pct: r.gross_profit_rate_pct == null ? null : Number(r.gross_profit_rate_pct),
    net_profit_rate_pct: r.net_profit_rate_pct == null ? null : Number(r.net_profit_rate_pct),
    turnover_times: r.turnover_times == null ? null : Number(r.turnover_times),
  };
}

function prevMonthStr(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

const SNAPSHOT_SQL = `
  SELECT k.*,
         CASE WHEN $3::text = 'tamkoko'
              THEN v.turnover_times
              ELSE NULL::numeric
         END AS turnover_times
    FROM %SCHEMA%.v_store_monthly_kpi k
    LEFT JOIN ${getDmSchema('tamkoko')}.v_inventory_turnover v
      ON v.store_code = k.store_code
     AND v.period = to_char(k.month, 'YYYY-MM')
   WHERE to_char(k.month, 'YYYY-MM') = $1 AND k.store_code = $2`;

/**
 * Fetch current + previous month KPI for a store.
 * Returns { data: null, note } when the DM view is not ready.
 * Returns { data: null } when no rows exist for the requested month.
 */
export async function getSnapshotData(
  brandRaw: string,
  store: string,
  month: string,
): Promise<SnapshotQueryResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };
  const schema = await getDmSchemaSafe(brand);
  const sql = SNAPSHOT_SQL.replace('%SCHEMA%', schema);

  try {
    const cur = await pool.query(sql, [month, store, brand]);
    if (cur.rows.length === 0) return { data: null };
    const prev = await pool.query(sql, [prevMonthStr(month), store, brand]);
    return {
      data: {
        current: toKpi(cur.rows[0]),
        previous: prev.rows.length > 0 ? toKpi(prev.rows[0]) : null,
      },
    };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }
}

export interface TrendQueryResult {
  data: TrendResponse | null;
  note?: string;
}

/**
 * Fetch last N months of trend series for a store.
 * Returns { data: null, note } when the DM view is not ready.
 */
export async function getTrendData(
  brandRaw: string,
  store: string,
  months = 12,
): Promise<TrendQueryResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };
  const schema = await getDmSchemaSafe(brand);
  const limit = Math.min(Math.max(months, 1), 24);

  let rows: any[];
  try {
    const r = await pool.query(
      `SELECT month,
              revenue_amt, cost_amt, expense_amt, hr_amt, rent_amt,
              gross_profit_amt, gross_profit_rate_pct,
              net_profit_amt, net_profit_rate_pct,
              operating_cf_amt, cash_balance, loan_balance, cashflow_runway_months,
              hr_ratio_pct, rent_ratio_pct
       FROM ${schema}.v_store_monthly_kpi
       WHERE store_code = $1
       ORDER BY month DESC
       LIMIT $2`,
      [store, limit]
    );
    rows = r.rows.reverse();
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }

  const series = {} as Record<TrendSeriesKey, (number | null)[]>;
  for (const k of TREND_SERIES_KEYS) series[k] = [];
  const monthList: string[] = [];

  for (const r of rows) {
    const m = r.month instanceof Date
      ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}`
      : String(r.month);
    monthList.push(m);
    for (const k of TREND_SERIES_KEYS) {
      const v = r[k as string];
      series[k].push(v == null ? null : Number(v));
    }
  }

  // TrendResponse.series is typed as Record<KpiMetricKey, ...>; the wider
  // TrendSeriesKey set is a superset and is preserved at runtime.
  return { data: { months: monthList, series: series as unknown as Record<KpiMetricKey, (number | null)[]> } };
}

export interface StoreRow {
  store_code: string;
  store_name: string;
}

/** Fetch enabled stores for a brand, ordered by sort_order then code. */
export async function getStoresForBrand(brand: string): Promise<StoreRow[]> {
  const res = await pool.query(
    `SELECT store_code, store_name
     FROM ops.stores
     WHERE brand_code = $1 AND enabled = true
     ORDER BY sort_order NULLS LAST, store_code`,
    [brand]
  );
  return res.rows;
}

export interface BrandRow {
  brand_code: string;
  brand_name: string;
}

/** Fetch all enabled brands for the selector, ordered by sort_order then code. */
export async function getBrands(): Promise<BrandRow[]> {
  const res = await pool.query(
    `SELECT brand_code, brand_name
     FROM ops.brands
     WHERE enabled = true
     ORDER BY sort_order NULLS LAST, brand_code`
  );
  return res.rows;
}
