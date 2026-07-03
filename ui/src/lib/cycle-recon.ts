// ui/src/lib/cycle-recon.ts
// Shared SQL helper for Tamkoko parent-company (苏州泰柯) settlement cycle
// reconciliation. Used by /api/income/cycle-recon and MCP tools.
//
// Use case: Tamkoko's WeChat + Alipay orders are first collected by the
// parent company "苏州泰柯餐饮管理有限公司", which then transfers funds
// to store accounts via periodic bank entries (周结每周, 月结每月).
//
// Algorithm: **LAG-based window** (like Taobao flash-sale). Each bank entry's
// Qimai window is derived from the previous bank entry's txn_time, so
// consecutive entries cover a contiguous Qimai range without overlap or
// gap, even for 2-week merged settlements or irregular monthly catch-ups.
//
//   window_end   = current_txn - (tOffset + 1) days
//   window_start = prev_txn    - tOffset days
//   first entry  → fallback: current_txn - 10 days
//
// tOffset default 3 (same as Meituan). Tune via query param.

export interface BuildCycleQueryOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  store?: string;
  periodEnd?: string | null;
  tOffset: number;
}

/**
 * Build a single SQL that joins each 苏州泰柯 bank entry to Qimai WeChat+
 * Alipay orders in its LAG-derived window. Returns rows like:
 *   { bank_date, bank_amt, window_days, qimai_count, qimai_amt, diff, entry_rate }
 */
export function buildCycleReconQuery(opts: BuildCycleQueryOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, incomeOds, store, periodEnd, tOffset } = opts;
  const params: unknown[] = [];
  const filterClauses: string[] = [];

  params.push(tOffset);
  if (store && store !== 'all') {
    params.push(store);
    filterClauses.push(`AND t.store_code = $${params.length}`);
  }
  if (periodEnd) {
    params.push(periodEnd);
    filterClauses.push(`AND t.txn_time < $${params.length}::DATE + INTERVAL '2 months'`);
    filterClauses.push(`AND t.txn_time >= $${params.length}::DATE - INTERVAL '3 months'`);
  }
  const storeParamRef = (store && store !== 'all') ? `$${2}` : `t.store_code`;

  const sql = `
    WITH txs AS (
      SELECT
        t.id AS bank_txn_id,
        t.txn_time,
        t.in_amt,
        t.store_code,
        LAG(t.txn_time) OVER (PARTITION BY t.store_code ORDER BY t.txn_time) AS prev_txn_time
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.classified_source IN ('rule', 'override')
        AND c.lvl1_code = 'REV_BIZ'
        AND c.lvl2_code IN ('WECHAT', 'ALIPAY')
        AND t.counterparty_name LIKE '%苏州泰柯餐饮管理有限公司%'
        AND t.in_amt > 0
        ${filterClauses.join('\n        ')}
    ),
    windows AS (
      SELECT
        bank_txn_id,
        txn_time,
        in_amt,
        (txn_time - ($1::int + 1) * INTERVAL '1 day')::DATE AS window_end,
        (COALESCE(prev_txn_time, txn_time - INTERVAL '10 days')::DATE - $1::int * INTERVAL '1 day')::DATE AS window_start
      FROM txs
    ),
    qimai_in_window AS (
      SELECT
        w.bank_txn_id,
        w.txn_time,
        w.in_amt AS bank_amt,
        w.window_start,
        w.window_end,
        COUNT(i.*)::int AS qimai_count,
        COALESCE(SUM(i.net_amt), 0)::numeric AS qimai_total
      FROM windows w
      LEFT JOIN ${incomeOds}.income_detail i
        ON i.store_code = ${storeParamRef}
        AND NOT i.is_refund
        AND NOT i.is_member_payment
        AND (i.payment_methods @> ARRAY['微信支付']::text[]
             OR i.payment_methods @> ARRAY['支付宝支付']::text[])
        AND i.biz_date >= w.window_start
        AND i.biz_date <= w.window_end
      GROUP BY w.bank_txn_id, w.txn_time, w.in_amt, w.window_start, w.window_end
    )
    SELECT
      to_char(txn_time, 'YYYY-MM-DD') AS bank_date,
      to_char(txn_time, 'YYYY-MM-DD') AS bank_date_str,
      bank_amt::numeric AS bank_amt,
      (window_end - window_start + 1)::int AS window_days,
      COALESCE(qimai_count, 0)::int AS qimai_count,
      qimai_total AS qimai_amt,
      (bank_amt - COALESCE(qimai_total, 0))::numeric AS diff,
      CASE WHEN qimai_total > 0
           THEN ROUND((bank_amt / qimai_total * 100)::numeric, 2)
           ELSE 0
      END AS entry_rate
    FROM qimai_in_window
    ORDER BY txn_time
  `;
  return [sql, params];
}

export const CYCLE_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;