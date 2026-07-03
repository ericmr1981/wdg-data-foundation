/**
 * douyin-recon.ts
 * 抖音团购对账 — 固定 T+5 偏移模式
 * 银行入账日期 = 企迈订单日期 + tOffset 天
 */

export const DOUYIN_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string;
  tOffset?: number;
}

/**
 * 抖音团购对账（固定 T+5 偏移）
 * 银行入账 = 企迈订单日 + offset 天
 */
export function buildDouyinDailyQuery(opts: ReconOpts): string {
  const offset = opts.tOffset ?? 5;
  return `
    WITH bank_douyin AS (
      SELECT
        txn_time::DATE AS bank_date,
        store_code,
        SUM(COALESCE(in_amt, 0)) AS bank_amt
      FROM ${opts.odsSchema}.bank_txn t
      JOIN ${opts.dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'DOUYIN'
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
      WHERE payment_methods @> ARRAY['抖音团购券']
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
    FROM bank_douyin b
    LEFT JOIN qimai_daily q
      ON q.qimai_date = b.bank_date - ${offset}::int * INTERVAL '1 day'
      AND q.store_code = b.store_code
    ORDER BY b.bank_date
  `;
}