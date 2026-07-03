/**
 * meituan-recon.ts
 * 美团对账 — 包含日常外卖（T+3 固定偏移）和团购（LAG 窗口匹配）两种模式
 */

export const MEITUAN_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string;
  tOffset?: number;
}

/**
 * 美团日常外卖对账（固定 T+3 偏移）
 * 银行入账日期 = 企迈订单日期 + tOffset 天
 */
export function buildMeituanDailyQuery(opts: ReconOpts): string {
  const offset = opts.tOffset ?? 3;
  return `
    WITH bank_meituan AS (
      SELECT
        txn_time::DATE AS bank_date,
        store_code,
        SUM(COALESCE(in_amt, 0)) AS bank_amt
      FROM ${opts.odsSchema}.bank_txn t
      JOIN ${opts.dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'MEITUAN'
        AND t.summary NOT LIKE '%团购%'
        AND c.classified_source IN ('rule', 'override')
        AND t.txn_time < '${opts.periodEnd}'::DATE
      GROUP BY txn_time::DATE, store_code
    ),
    qimai_daily AS (
      SELECT
        biz_date AS qimai_date,
        store_code,
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS qimai_amt
      FROM ${opts.incomeOds}.income_detail
      WHERE ('美团外卖支付' = ANY(payment_methods) OR '美团在线点单' = ANY(payment_methods))
        AND NOT (payment_methods @> ARRAY['美团团购券'])
      GROUP BY biz_date, store_code
    )
    SELECT
      b.bank_date,
      b.bank_amt,
      b.store_code,
      COALESCE(q.order_count, 0) AS qimai_count,
      COALESCE(q.qimai_amt, 0) AS qimai_amt,
      b.bank_amt - COALESCE(q.qimai_amt, 0) AS diff,
      CASE WHEN COALESCE(q.qimai_amt, 0) > 0
        THEN ROUND((b.bank_amt / q.qimai_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM bank_meituan b
    LEFT JOIN qimai_daily q
      ON q.qimai_date = b.bank_date - ${offset}::int * INTERVAL '1 day'
      AND q.store_code = b.store_code
    ORDER BY b.bank_date
  `;
}

/**
 * 美团团购对账（LAG 窗口匹配模式）
 * 每次银行团购打款对应前 N 天的企迈团购订单窗口
 */
export function buildMeituanTuangouQuery(opts: ReconOpts): string {
  const offset = opts.tOffset ?? 3;
  return `
    WITH bank_tuangou AS (
      SELECT
        t.id, t.store_code, t.txn_time, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${opts.odsSchema}.bank_txn t
      JOIN ${opts.dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE t.summary LIKE '%团购%'
        AND c.lvl2_code = 'MEITUAN'
        AND c.classified_source IN ('rule', 'override')
        AND t.txn_time < '${opts.periodEnd}'::DATE
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
        (w.txn_time - (${offset} + 1) * INTERVAL '1 day')::DATE AS window_end,
        (COALESCE(w.prev_txn_time, w.txn_time - INTERVAL '10 days') - ${offset} * INTERVAL '1 day')::DATE AS window_start
      FROM windows w
    )
    SELECT
      wf.bank_date,
      wf.bank_amt,
      wf.window_start || ' ~ ' || wf.window_end AS qimai_window,
      (wf.window_end - wf.window_start) AS window_days,
      COALESCE(qi.order_count, 0) AS qimai_count,
      COALESCE(qi.total_amt, 0) AS qimai_total,
      wf.bank_amt - COALESCE(qi.total_amt, 0) AS diff
    FROM windows_final wf
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS total_amt
      FROM ${opts.incomeOds}.income_detail q
      WHERE q.store_code = wf.store_code
        AND q.payment_methods @> ARRAY['美团团购券']
        AND q.biz_date >= wf.window_start
        AND q.biz_date <= wf.window_end
    ) qi ON true
    ORDER BY wf.bank_date
  `;
}