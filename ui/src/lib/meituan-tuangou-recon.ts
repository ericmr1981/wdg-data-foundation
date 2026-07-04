/**
 * meituan-tuangou-recon.ts
 * 美团团购券对账 — LAG 窗口匹配模式
 *
 * 银行端: lvl2_code='MEITUAN' AND summary 含 "团购"
 * 企迈端: payment_methods 含 "美团团购券"
 *
 * 窗口算法: LAG-based 连续窗口
 */

export interface TuangouOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string | null;
  tOffset: number;
  store?: string | null;
}

export function buildMeituanTuangouQuery(opts: TuangouOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, incomeOds, periodEnd, tOffset, store } = opts;
  const params: unknown[] = [];
  const filterClauses: string[] = [];
  if (periodEnd) {
    params.push(periodEnd);
    filterClauses.push(`AND t.txn_time < $${params.length}::DATE`);
  }
  if (store && store !== 'all') {
    params.push(store);
    filterClauses.push(`AND t.store_code = $${params.length}`);
  }

  const sql = `
    WITH bank_tuangou AS (
      SELECT
        t.id, t.store_code, t.txn_time, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE t.summary LIKE '%团购%'
        AND c.lvl2_code = 'MEITUAN'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
    ),
    windows AS (
      SELECT
        b.id, b.store_code, b.txn_time, b.bank_amt,
        LAG(b.txn_time) OVER (PARTITION BY b.store_code ORDER BY b.txn_time) AS prev_txn_time
      FROM bank_tuangou b
    ),
    windows_final AS (
      SELECT
        w.id, w.store_code, w.txn_time::DATE AS bank_date, w.bank_amt,
        (w.txn_time - ($${params.length + 1}::int + 1) * INTERVAL '1 day')::DATE AS window_end,
        (COALESCE(w.prev_txn_time, w.txn_time - INTERVAL '10 days') - $${params.length + 1}::int * INTERVAL '1 day')::DATE AS window_start
      FROM windows w
    )
    SELECT
      to_char(wf.bank_date, 'YYYY-MM-DD')            AS bank_date_str,
      wf.bank_amt,
      wf.store_code,
      to_char(wf.window_start, 'YYYY-MM-DD') || ' ~ ' || to_char(wf.window_end, 'YYYY-MM-DD') AS qimai_window,
      GREATEST(0, (wf.window_end - wf.window_start + 1))::int AS window_days,
      COALESCE(qi.order_count, 0)::int AS qimai_count,
      COALESCE(qi.total_amt, 0)::numeric AS qimai_total,
      wf.bank_amt - COALESCE(qi.total_amt, 0) AS diff,
      CASE WHEN COALESCE(qi.total_amt, 0) > 0
        THEN ROUND((wf.bank_amt / qi.total_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM windows_final wf
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS total_amt
      FROM ${incomeOds}.income_detail q
      WHERE q.store_code = wf.store_code
        AND q.payment_methods @> ARRAY['美团团购券']::text[]
        AND q.biz_date >= wf.window_start
        AND q.biz_date <= wf.window_end
    ) qi ON true
    ORDER BY wf.bank_date
  `;
  params.push(tOffset);
  return [sql, params];
}
