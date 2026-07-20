import pool from '@/lib/db';
import { buildPeriodBoundaries, buildStoreCondition } from './financial-utils';
import type {
  ProfitRow, CashflowRow, BalanceSheetRow, OverviewData,
  KpiTrendRow, IncomeMetricsRow, PaymentMetricsRow, CounterpartyRow,
} from './financial-types';

// ── Profit statement ──

export async function getProfitStatement(
  dmSchema: string, period: string, span: string, store: string
): Promise<ProfitRow[]> {
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return [];
  const sc = buildStoreCondition(store, 3);
  const result = await pool.query<ProfitRow>(`
    SELECT section, lvl1_code, lvl1_name, lvl2_code, lvl2_name,
           sum(amount) as amount
    FROM ${dmSchema}.v_profit_statement
    WHERE month >= $1::date AND month < $2::date ${sc.clause}
    GROUP BY section, lvl1_code, lvl1_name, lvl2_code, lvl2_name
    ORDER BY min(sort_order), lvl1_code, lvl2_code
  `, [boundaries.start, boundaries.end, ...sc.params]);
  return result.rows;
}

export async function getCogsTotal(
  dmSchema: string, period: string, span: string, store: string
): Promise<number | null> {
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return null;
  const sc = buildStoreCondition(store, 3);
  try {
    const result = await pool.query<{ cogs_total: string | null }>(`
      SELECT COALESCE(SUM(cogs_amt), 0)::numeric AS cogs_total
      FROM ${dmSchema}.v_cogs_monthly
      WHERE period >= to_char($1::date, 'YYYY-MM')
        AND period <  to_char($2::date, 'YYYY-MM')
        ${sc.clause}
    `, [boundaries.start, boundaries.end, ...sc.params]);
    return result.rows[0]?.cogs_total != null ? Number(result.rows[0].cogs_total) : null;
  } catch {
    return null;
  }
}

// ── Financial overview (combines 4 queries) ──

export async function getFinancialOverview(
  dmSchema: string, odsSchema: string, period: string, span: string, store: string
): Promise<OverviewData> {
  const isAll = period === 'all';
  const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
  if (!isAll && !boundaries) {
    return { profit: [], cashflow: [], balance: null, cogs_total: '0', qimai_net: null, qimai_gross: null };
  }

  const profitParams: (string | number)[] = [];
  let profitDateClause = '';
  if (!isAll && boundaries) {
    profitDateClause = 'AND month >= $1::date AND month < $2::date';
    profitParams.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    profitDateClause += ` AND store_code = $${profitParams.length + 1}`;
    profitParams.push(store);
  }
  const profitPromise = pool.query<ProfitRow>(`
    SELECT lvl1_code, sum(amount) as amount
    FROM ${dmSchema}.v_profit_statement
    WHERE 1=1 ${profitDateClause}
    GROUP BY lvl1_code
  `, profitParams);

  const cfParams: (string | number)[] = [];
  let cfDateClause = '';
  if (!isAll && boundaries) {
    cfDateClause = 'AND month >= $1::date AND month < $2::date';
    cfParams.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    cfDateClause += ` AND store_code = $${cfParams.length + 1}`;
    cfParams.push(store);
  }
  const cfPromise = pool.query<CashflowRow>(`
    SELECT activity, sum(net_amount) as net_amount
    FROM ${dmSchema}.v_cashflow_statement
    WHERE 1=1 ${cfDateClause}
    GROUP BY activity
  `, cfParams);

  const balParams: (string | number)[] = [];
  let balDateClause = '';
  if (!isAll && boundaries) {
    balDateClause = 'AND month < $1::date';
    balParams.push(boundaries.end);
  }
  if (store !== 'all') {
    balDateClause += ` AND store_code = $${balParams.length + 1}`;
    balParams.push(store);
  }
  const balancePromise = pool.query<BalanceSheetRow>(`
    SELECT cash_balance
    FROM ${dmSchema}.v_balance_sheet
    WHERE 1=1 ${balDateClause}
    ORDER BY month DESC LIMIT 1
  `, balParams);

  const cogsParams: (string | number)[] = [];
  let cogsDateClause = '';
  if (!isAll && boundaries) {
    cogsDateClause = `AND period >= to_char($1::date, 'YYYY-MM')
      AND period <  to_char($2::date, 'YYYY-MM')`;
    cogsParams.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    cogsDateClause += ` AND store_code = $${cogsParams.length + 1}`;
    cogsParams.push(store);
  }
  const cogsPromise = pool.query<{ cogs_total: string }>(`
    SELECT COALESCE(SUM(cogs_amt), 0)::numeric AS cogs_total
    FROM ${dmSchema}.v_cogs_monthly
    WHERE 1=1 ${cogsDateClause}
  `, cogsParams).catch(() => ({ rows: [{ cogs_total: '0' }] }));

  const qimaiParams: (string | number)[] = [];
  let qimaiDateClause = '';
  if (!isAll && boundaries) {
    qimaiDateClause = 'AND biz_date >= $1::date AND biz_date < $2::date';
    qimaiParams.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    qimaiDateClause += ` AND store_code = $${qimaiParams.length + 1}`;
    qimaiParams.push(store);
  }
  const qimaiPromise = pool.query<{ qimai_net: string; qimai_gross: string }>(`
    SELECT
      COALESCE(SUM(net_amt), 0)::numeric   AS qimai_net,
      COALESCE(SUM(gross_amt), 0)::numeric AS qimai_gross
    FROM ${odsSchema}.income_detail
    WHERE NOT COALESCE(is_member_payment, FALSE)
      AND NOT COALESCE(is_refund, FALSE)
      ${qimaiDateClause}
  `, qimaiParams).catch(() => ({ rows: [] }));

  const [profitRes, cfRes, balanceRes, cogsRes, qimaiRes] = await Promise.all([
    profitPromise, cfPromise, balancePromise, cogsPromise, qimaiPromise,
  ]);

  return {
    profit: profitRes.rows,
    cashflow: cfRes.rows,
    balance: balanceRes.rows[0] || null,
    cogs_total: cogsRes.rows[0]?.cogs_total || '0',
    qimai_net: qimaiRes.rows[0]?.qimai_net ?? null,
    qimai_gross: qimaiRes.rows[0]?.qimai_gross ?? null,
  };
}

// ── Cashflow statement ──

export async function getCashflowStatement(
  dmSchema: string, period: string, span: string, store: string
): Promise<CashflowRow[]> {
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return [];
  const sc = buildStoreCondition(store, 3);
  const result = await pool.query<CashflowRow>(`
    SELECT activity, lvl1_code, lvl2_code,
           sum(total_in) as total_in,
           sum(total_out) as total_out,
           sum(net_amount) as net_amount
    FROM ${dmSchema}.v_cashflow_statement
    WHERE month >= $1::date AND month < $2::date ${sc.clause}
    GROUP BY activity, lvl1_code, lvl2_code
    ORDER BY min(sort_order)
  `, [boundaries.start, boundaries.end, ...sc.params]);
  return result.rows;
}

export async function getInventoryChange(
  dmSchema: string, period: string, span: string, store: string
): Promise<{ opening_total: number; closing_total: number }> {
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return { opening_total: 0, closing_total: 0 };
  const sc = buildStoreCondition(store, 3);
  try {
    const result = await pool.query<{ opening_total: string; closing_total: string }>(`
      SELECT
        COALESCE(SUM(opening_amt), 0)::numeric AS opening_total,
        COALESCE(SUM(closing_amt), 0)::numeric AS closing_total
      FROM ${dmSchema}.v_cogs_monthly
      WHERE period >= to_char($1::date, 'YYYY-MM')
        AND period <  to_char($2::date, 'YYYY-MM')
        ${sc.clause}
    `, [boundaries.start, boundaries.end, ...sc.params]);
    return {
      opening_total: Number(result.rows[0]?.opening_total || 0),
      closing_total: Number(result.rows[0]?.closing_total || 0),
    };
  } catch {
    return { opening_total: 0, closing_total: 0 };
  }
}

// ── Balance sheet (end-of-period snapshot) ──

export async function getBalanceSheet(
  dmSchema: string, period: string, span: string, store: string
): Promise<BalanceSheetRow[]> {
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return [];
  const sc = buildStoreCondition(store, 2);
  const result = await pool.query<BalanceSheetRow>(`
    SELECT cash_balance
    FROM ${dmSchema}.v_balance_sheet
    WHERE month < $1::date ${sc.clause}
    ORDER BY month DESC LIMIT 1
  `, [boundaries.end, ...sc.params]);
  return result.rows;
}

// ── Beginning balance (as-of startDate) ──

export async function getBeginningBalance(
  dmSchema: string, period: string, span: string, store: string
): Promise<BalanceSheetRow[]> {
  // Beginning balance is undefined for "all" — caller (route) renders null.
  if (period === 'all') return [];
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return [];
  const sc = buildStoreCondition(store, 2);
  const result = await pool.query<BalanceSheetRow>(`
    SELECT cash_balance
    FROM ${dmSchema}.v_balance_sheet
    WHERE month < $1::date ${sc.clause}
    ORDER BY month DESC LIMIT 1
  `, [boundaries.start, ...sc.params]);
  return result.rows;
}

// ── Store count ──

export async function getActiveStoreCount(
  dmSchema: string, period: string, span: string, store: string
): Promise<number> {
  if (store !== 'all') return 1;
  if (period === 'all') {
    // storeCount = currently enabled stores. ops.stores is the source of truth and is
    // period-independent, so we always read it for 'all'. Derive brand_code from dmSchema
    // (strip _dm suffix; strip legacy brand_ prefix if present).
    // Fallback to distinct store_codes in v_profit_statement when ops.stores has no
    // rows for the brand (some brands e.g. gelatomiiix / tamkoko are not seeded there
    // yet) so the dashboard still shows a meaningful count.
    const brandCode = dmSchema.replace(/_dm$/, '').replace(/^brand_/, '');
    const opsRes = await pool.query<{ cnt: string }>(
      `SELECT count(*) as cnt FROM ops.stores WHERE enabled = true AND brand_code = $1`,
      [brandCode]
    );
    const opsCount = Number(opsRes.rows[0]?.cnt || 0);
    if (opsCount > 0) return opsCount;
    const txRes = await pool.query<{ cnt: string }>(`
      SELECT count(DISTINCT store_code) as cnt
      FROM ${dmSchema}.v_profit_statement
    `);
    return Number(txRes.rows[0]?.cnt || 0);
  }
  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return 0;
  const result = await pool.query<{ cnt: string }>(`
    SELECT count(DISTINCT store_code) as cnt
    FROM ${dmSchema}.v_profit_statement
    WHERE month >= $1::date AND month < $2::date
  `, [boundaries.start, boundaries.end]);
  return Number(result.rows[0]?.cnt || 0);
}

// ── Net profit rate / Gross margin from v_store_monthly_kpi ──

export async function getKpiRate(
  dmSchema: string, period: string, span: string, store: string, field: 'net_profit_rate_pct' | 'gross_profit_rate_pct'
): Promise<number | null> {
  const isAll = period === 'all';
  const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
  if (!isAll && !boundaries) return null;

  const params: (string | number)[] = [];
  let dateClause = '';
  if (!isAll && boundaries) {
    dateClause = 'AND month >= $1::date AND month < $2::date';
    params.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    dateClause += ` AND store_code = $${params.length + 1}`;
    params.push(store);
  }

  const result = await pool.query<{ rate_pct: string | null }>(`
    SELECT AVG(${field}) as rate_pct
    FROM ${dmSchema}.v_store_monthly_kpi
    WHERE 1=1 ${dateClause}
  `, params);
  const raw = result.rows[0]?.rate_pct;
  return raw != null ? Number(raw) / 100 : null;
}

// ── Operating expenses (sum of operating categories only) ──

export async function getOperatingExpenses(
  dmSchema: string, period: string, span: string, store: string
): Promise<number> {
  const isAll = period === 'all';
  const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
  if (!isAll && !boundaries) return 0;

  const params: (string | number)[] = [];
  let dateClause = '';
  if (!isAll && boundaries) {
    dateClause = 'AND month >= $1::date AND month < $2::date';
    params.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    dateClause += ` AND store_code = $${params.length + 1}`;
    params.push(store);
  }

  const result = await pool.query<{ operating_expenses: string }>(`
    SELECT COALESCE(SUM(ABS(amount)), 0)::numeric AS operating_expenses
    FROM ${dmSchema}.v_profit_statement
    WHERE lvl1_code IN ('MATERIAL','HR','MKT','RENT_UTIL','SHIP','ADMIN','TAX_SURCHARGE')
      ${dateClause}
  `, params);
  return Number(result.rows[0]?.operating_expenses || 0);
}

// ── Qimai revenue (cumulative to end of period) ──

export async function getQimaiRevenue(
  dmSchema: string, odsSchema: string, incomeOds: string, period: string, span: string, store: string
): Promise<{ bank_revenue: number; qimai_revenue: number | null }> {
  const isAll = period === 'all';
  const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
  if (!isAll && !boundaries) return { bank_revenue: 0, qimai_revenue: null };

  // For "all" period, cumulative through CURRENT_DATE; otherwise boundaries.end.
  const storeParams: (string | number)[] = [];
  let bankDateClause = '';
  let qimaiDateClause = '';
  if (isAll) {
    bankDateClause = 'AND month < CURRENT_DATE';
    qimaiDateClause = 'AND biz_date < CURRENT_DATE';
  } else if (boundaries) {
    bankDateClause = 'AND month < $1::date';
    qimaiDateClause = 'AND biz_date < $1::date';
    storeParams.push(boundaries.end);
  }
  if (store !== 'all') {
    bankDateClause += ` AND store_code = $${storeParams.length + 1}`;
    qimaiDateClause += ` AND store_code = $${storeParams.length + 1}`;
    storeParams.push(store);
  }

  let bankRevenue = 0;
  try {
    const brRes = await pool.query(`
      SELECT COALESCE(SUM(amount), 0)::numeric as bank_revenue
      FROM ${dmSchema}.v_profit_statement
      WHERE section = 'revenue' AND lvl1_code = 'REV_BIZ'
        AND lvl2_code != 'OTHER_CH'
        ${bankDateClause}
    `, storeParams);
    bankRevenue = Number(brRes.rows[0]?.bank_revenue || 0);
  } catch { /* view not ready */ }

  let qimaiRevenue: number | null = null;
  try {
    const qiRes = await pool.query(`
      SELECT COALESCE(SUM(net_amt), 0)::numeric as qimai_revenue
      FROM ${incomeOds}.income_detail
      WHERE NOT is_member_payment AND NOT is_refund
        ${qimaiDateClause}
    `, storeParams);
    qimaiRevenue = Number(qiRes.rows[0]?.qimai_revenue || 0);
  } catch { /* income_detail not available */ }

  return { bank_revenue: bankRevenue, qimai_revenue: qimaiRevenue };
}

// ── KPI trend (trailing 12 months) ──

export async function getKpiTrend(
  dmSchema: string, _period: string, _span: string, store: string
): Promise<KpiTrendRow[]> {
  const odsSchema = dmSchema.replace('_dm', '_ods');
  const storeClause = store !== 'all' ? 'AND t.store_code = $1' : '';
  const storeParams = store !== 'all' ? [store] : [];

  const result = await pool.query<KpiTrendRow>(`
    SELECT
      to_char(date_trunc('month', t.txn_time)::date, 'YYYY-MM') as month,
      COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as revenue_amt,
      COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_OTHER' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as rev_other_amt,
      COALESCE(SUM(CASE WHEN c.lvl1_code = 'MATERIAL' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as material_cost_amt,
      COALESCE(SUM(coalesce(t.in_amt,0) - coalesce(t.out_amt,0)), 0) as net_profit_amt,
      COALESCE(ABS(SUM(CASE WHEN c.lvl1_code IN ('MATERIAL','HR','RENT_UTIL','MKT','ADMIN','SHIP','TAX_SURCHARGE','EXP_OTHER','BUILD') THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END)), 0) as expense_amt,
      COALESCE(ABS(SUM(CASE WHEN c.lvl1_code IN ('HR','MKT','RENT_UTIL','SHIP','ADMIN') THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END)), 0) as non_cogs_exp_amt
    FROM ${dmSchema}.bank_txn_classified_snapshot c
    JOIN ${odsSchema}.bank_txn t ON t.id = c.bank_txn_id
    WHERE c.classified_source IN ('rule', 'override') ${storeClause}
    GROUP BY date_trunc('month', t.txn_time)::date
    ORDER BY month DESC
    LIMIT 12
  `, storeParams);
  return result.rows;
}

// ── Income metrics (lvl1 breakdown of inflows) ──

export async function getIncomeMetrics(
  dmSchema: string, _cfgSchema: string, period: string, span: string, store: string
): Promise<IncomeMetricsRow[]> {
  const isAll = period === 'all';
  const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
  if (!isAll && !boundaries) return [];

  const params: (string | number)[] = [];
  let dateClause = '';

  if (!isAll && boundaries) {
    dateClause = 'AND month >= $1::date AND month < $2::date';
    params.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    dateClause += ` AND store_code = $${params.length + 1}`;
    params.push(store);
  }

  const result = await pool.query(`
    SELECT lvl1_code, sum(net_amount) as amount
    FROM ${dmSchema}.v_cashflow_statement
    WHERE net_amount > 0 ${dateClause}
    GROUP BY lvl1_code
    ORDER BY amount DESC
  `, params);
  return result.rows as unknown as IncomeMetricsRow[];
}

// ── Payment metrics (lvl1 breakdown of outflows) ──

export async function getPaymentMetrics(
  dmSchema: string, _cfgSchema: string, period: string, span: string, store: string
): Promise<PaymentMetricsRow[]> {
  const isAll = period === 'all';
  const boundaries = isAll ? null : buildPeriodBoundaries(period, span);
  if (!isAll && !boundaries) return [];

  const params: (string | number)[] = [];
  let dateClause = '';

  if (!isAll && boundaries) {
    dateClause = 'AND month >= $1::date AND month < $2::date';
    params.push(boundaries.start, boundaries.end);
  }
  if (store !== 'all') {
    dateClause += ` AND store_code = $${params.length + 1}`;
    params.push(store);
  }

  const result = await pool.query(`
    SELECT lvl1_code, sum(abs(net_amount)) as amount
    FROM ${dmSchema}.v_cashflow_statement
    WHERE net_amount < 0 ${dateClause}
    GROUP BY lvl1_code
    ORDER BY amount DESC
  `, params);
  return result.rows as unknown as PaymentMetricsRow[];
}

// ── Counterparty list ──

export async function getCounterpartyData(
  dmSchema: string, bankTxnTable: string, period: string, span: string, store: string,
  direction: string = 'out', lvl2Code?: string
): Promise<CounterpartyRow[]> {
  const isAll = period === 'all' || period === '';
  if (!isAll) {
    const boundaries = buildPeriodBoundaries(period, span);
    if (!boundaries) return [];
  }

  const cfgSchema = dmSchema.replace('_dm', '_cfg');
  const isIn = direction === 'in';
  const amountField = isIn ? 'in_amt' : 'out_amt';
  const totalField = isIn ? 'total_received' : 'total_paid';

  const params: (string | number)[] = [];
  let dateClause = '';
  let storeClause = '';
  let channelClause = '';

  if (lvl2Code) {
    channelClause = 'AND c.lvl2_code = $' + (params.length + 1);
    params.push(lvl2Code);
  }
  if (store !== 'all') {
    storeClause = 'AND t.store_code = $' + (params.length + 1);
    params.push(store);
  }
  if (!isAll) {
    const boundaries = buildPeriodBoundaries(period, span)!;
    dateClause = 'AND t.txn_time >= $' + (params.length + 1) + '::timestamp AND t.txn_time < $' + (params.length + 2) + '::timestamp';
    params.push(boundaries.start, boundaries.end);
  }

  const result = await pool.query(`
    SELECT CASE
             WHEN t.counterparty_name IS NOT NULL AND t.counterparty_name != '' THEN t.counterparty_name
             WHEN t.purpose IS NOT NULL AND t.purpose != '' AND t.purpose != 'NaN' THEN t.purpose
             WHEN t.summary IS NOT NULL AND t.summary != '' THEN t.summary
             ELSE '（未知名）'
           END as counterparty_name,
           c.lvl1_code,
           l1.lvl1_name,
           sum(coalesce(t.${amountField}, 0)) as ${totalField},
           count(*) as txn_count,
           min(t.txn_time) as first_date,
           max(t.txn_time) as last_date
    FROM ${bankTxnTable} t
    JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
    LEFT JOIN ${cfgSchema}.dim_category_lvl1 l1 ON l1.lvl1_code = c.lvl1_code
    WHERE c.classified_source IN ('rule', 'override')
      AND coalesce(t.${amountField}, 0) > 0
      ${dateClause}
      ${storeClause}
      ${channelClause}
    GROUP BY CASE
               WHEN t.counterparty_name IS NOT NULL AND t.counterparty_name != '' THEN t.counterparty_name
               WHEN t.purpose IS NOT NULL AND t.purpose != '' AND t.purpose != 'NaN' THEN t.purpose
               WHEN t.summary IS NOT NULL AND t.summary != '' THEN t.summary
               ELSE '（未知名）'
             END,
             c.lvl1_code, l1.lvl1_name
    ORDER BY ${totalField} DESC
  `, params);
  return result.rows as unknown as CounterpartyRow[];
}
