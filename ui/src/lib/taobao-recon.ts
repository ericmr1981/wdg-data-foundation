/**
 * taobao-recon.ts
 * 淘宝闪购对账 — LAG 窗口匹配模式
 * 每次银行打款对应前 N 天的企迈订单窗口，通过 LAG 计算相邻打款间隔作为窗口边界
 */

export const TAOBAO_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string;
}

export function buildTaobaoReconQuery(opts: ReconOpts): string {
  const { odsSchema, dmSchema, incomeOds, periodEnd } = opts;
  return `
    WITH bank_dedup AS (
      SELECT DISTINCT ON (t.id)
        t.id, t.store_code, t.txn_time, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'TAOBAO'
        AND c.classified_source IN ('rule', 'override')
        AND t.txn_time < '${periodEnd}'::DATE
    ),
    windows AS (
      SELECT
        bd.id, bd.store_code, bd.txn_time, bd.bank_amt,
        LAG(bd.txn_time) OVER (PARTITION BY bd.store_code ORDER BY bd.txn_time) AS prev_txn_time,
        (bd.txn_time - INTERVAL '4 days')::DATE AS window_end
      FROM bank_dedup bd
    ),
    windows_final AS (
      SELECT
        w.id, w.store_code, w.txn_time::DATE AS bank_date, w.bank_amt,
        w.window_end,
        COALESCE(w.prev_txn_time::DATE, w.txn_time::DATE - 10) AS window_start
      FROM windows w
    )
    SELECT
      wf.bank_date,
      wf.bank_amt,
      wf.window_start || ' ~ ' || wf.window_end AS qimai_window,
      (wf.window_end - wf.window_start) AS window_days,
      COALESCE(qi.order_count, 0) AS qimai_count,
      COALESCE(qi.total_amt, 0) AS qimai_total,
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
        AND q.payment_methods @> ARRAY['淘宝闪购支付']
        AND q.biz_date >= wf.window_start
        AND q.biz_date <= wf.window_end
    ) qi ON true
    ORDER BY wf.bank_date
  `;
}