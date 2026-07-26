// Shared server-side query functions for the payment (付款分析) module.
// Used by both the RSC page (u/payment/page.tsx) and the API routes
// (api/financial/counterparty + api/financial/payment-metrics).
// Pure DB access — no auth, no HTTP. Auth is the caller's responsibility.

import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getOdsBankTxnTable, getCfgSchema } from '@/lib/brand-server';
import { getCounterpartyData, getPaymentMetrics as repoGetPaymentMetrics } from '@/lib/repositories/financial-repository';
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

export interface CounterpartySummary {
  counterparty_name: string;
  total_paid: number;
  txn_count: number;
  first_date: string;
  last_date: string;
}

export interface PaymentLvl1 {
  lvl1_code: string;
  lvl1_name: string;
  amount: number;
}

export interface PaymentTrend {
  month: string;
  amount: number;
}

export interface PaymentMetricsResult {
  data: {
    total_out: number;
    by_lvl1: PaymentLvl1[];
    monthly_trend: PaymentTrend[];
  } | null;
  note?: string;
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
  return res.rows;
}

// ── Brands ───────────────────────────────────────────────────────────────────

/** Fetch all enabled brands for the selector, ordered by sort_order then code. */
export async function getBrands(): Promise<BrandRow[]> {
  const res = await pool.query(
    `SELECT brand_code, brand_name
       FROM ops.brands
      WHERE enabled = true
      ORDER BY sort_order NULLS LAST, brand_code`,
  );
  return res.rows;
}

// ── Counterparty list ────────────────────────────────────────────────────────

function toCounterpartySummary(r: Record<string, unknown>): CounterpartySummary {
  return {
    counterparty_name: String(r.counterparty_name || ''),
    total_paid: Number(r.total_paid || 0),
    txn_count: Number(r.txn_count || 0),
    first_date: r.first_date != null ? String(r.first_date) : '',
    last_date: r.last_date != null ? String(r.last_date) : '',
  };
}

/** Fetch counterparty list for the payment sidebar. */
export async function getCounterpartyList(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<{ data: CounterpartySummary[] | null; note?: string }> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };

  let dmSchema: string;
  let bankTxnTable: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
    bankTxnTable = getOdsBankTxnTable(brand);
  } catch {
    return { data: null, note: 'view not ready' };
  }

  try {
    const rows = await getCounterpartyData(dmSchema, bankTxnTable, period, span, store);
    return { data: rows.map((r) => toCounterpartySummary(r as unknown as Record<string, unknown>)) };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }
}

// ── Payment metrics ──────────────────────────────────────────────────────────

/** Fetch payment metrics (totals + lvl1 breakdown + monthly trend). */
export async function getPaymentMetrics(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<PaymentMetricsResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { data: null };

  let dmSchema: string;
  let cfgSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
    cfgSchema = getCfgSchema(brand);
  } catch {
    return { data: null, note: 'view not ready' };
  }

  try {
    // Dim lookup for lvl1 names
    const dimQuery = `SELECT lvl1_code, lvl1_name FROM ${cfgSchema}.dim_category_lvl1`;

    // Monthly trend (last 12 months)
    const trendStoreClause = store !== 'all' ? 'AND store_code = $1' : '';
    const trendParams: (string | number)[] = store !== 'all' ? [store] : [];
    const trendQuery = `
      SELECT to_char(month, 'YYYY-MM') as month, sum(abs(net_amount)) as amount
      FROM ${dmSchema}.v_cashflow_statement
      WHERE net_amount < 0 ${trendStoreClause}
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `;

    const lvl1Result = await repoGetPaymentMetrics(dmSchema, cfgSchema, period, span, store);
    const [dimRes, trendRes] = await Promise.all([
      pool.query(dimQuery),
      pool.query(trendQuery, trendParams),
    ]);

    const dimMap = new Map(
      (dimRes.rows as { lvl1_code: string; lvl1_name: string }[]).map((r) => [
        r.lvl1_code,
        r.lvl1_name,
      ]),
    );

    const byLvl1: PaymentLvl1[] = lvl1Result.map((r) => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: dimMap.get(r.lvl1_code) || r.lvl1_code,
      amount: Number(r.amount),
    }));

    const totalOut = byLvl1.reduce((s, r) => s + r.amount, 0);

    const monthlyTrend: PaymentTrend[] = (trendRes.rows as { month: string; amount: string }[])
      .map((r) => ({ month: r.month, amount: Number(r.amount) }))
      .reverse();

    return { data: { total_out: totalOut, by_lvl1: byLvl1, monthly_trend: monthlyTrend } };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { data: null, note: 'view not ready' };
    throw e;
  }
}
