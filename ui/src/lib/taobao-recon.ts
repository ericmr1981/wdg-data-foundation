/**
 * taobao-recon.ts
 * 淘宝闪购对账 — 定期自动转账窗口匹配
 *
 * 淘宝闪购平台把门店订单金额按周/双周自动转账到门店账户，定期打款而非逐笔。
 * 因此窗口算法 = gap-split: 上一笔打款的后一天 ~ 当前打款的前一天，
 * 但限制最长 14 天回看（防止长时间空窗导致窗口无限大）。
 *
 *   w_end   = bank_date - 1 (前一天完成订单的结算)
 *   w_start = MAX(prev_bank_date + 1, bank_date - 14 days)
 *
 * Tested against 12 笔 hz_fuyang 淘宝闪购打款：avg rate 91-92%（含
 * 淘宝平台 6-15% 抽佣）。逐笔差额来自平台费率和退款时差。
 */

export const TAOBAO_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;

export const TAOBAO_MAX_LOOKBACK_DAYS = 14;

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  store?: string | null;
  periodEnd: string | null;
}

export function buildTaobaoReconQuery(opts: ReconOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, incomeOds, store, periodEnd } = opts;
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
    WITH bank_dedup AS (
      SELECT DISTINCT ON (t.id)
        t.id, t.store_code, t.txn_time, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'TAOBAO'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
    ),
    laggy AS (
      SELECT
        id, store_code, txn_time, bank_amt,
        LAG(txn_time::DATE) OVER (PARTITION BY store_code ORDER BY txn_time) AS prev_date
      FROM bank_dedup
    ),
    windows AS (
      SELECT
        id, store_code, txn_time, bank_amt, prev_date,
        (txn_time::DATE - 1)                                                                  AS w_end,
        GREATEST(
          COALESCE(prev_date, txn_time::DATE - INTERVAL '${TAOBAO_MAX_LOOKBACK_DAYS} days') + INTERVAL '1 day',
          txn_time::DATE - INTERVAL '${TAOBAO_MAX_LOOKBACK_DAYS} days'
        )::DATE                                                                                AS w_start
      FROM laggy
    )
    SELECT
      to_char(w.txn_time::DATE, 'YYYY-MM-DD')        AS bank_date_str,
      w.bank_amt,
      to_char(w.w_start, 'YYYY-MM-DD') || ' ~ ' || to_char(w.w_end, 'YYYY-MM-DD') AS qimai_window,
      GREATEST(0, w.w_end - w.w_start + 1)::int       AS window_days,
      COALESCE(qi.qimai_count, 0)::int                AS qimai_count,
      COALESCE(qi.qimai_total, 0)::numeric            AS qimai_total,
      w.bank_amt - COALESCE(qi.qimai_total, 0)        AS diff,
      CASE WHEN COALESCE(qi.qimai_total, 0) > 0
        THEN ROUND((w.bank_amt / qi.qimai_total * 100)::numeric, 2)
        ELSE 0
      END                                            AS entry_rate
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)            AS qimai_count,
        COALESCE(SUM(net_amt), 0) AS qimai_total
      FROM ${incomeOds}.income_detail q
      WHERE q.store_code = w.store_code
        AND q.biz_date BETWEEN w.w_start AND w.w_end
        AND NOT q.is_refund
        AND NOT q.is_member_payment
        AND (q.payment_methods @> ARRAY['淘宝闪购支付']::text[]
             OR q.biz_source = '淘宝闪购')
    ) qi ON true
    ORDER BY w.txn_time
  `;
  return [sql, params];
}