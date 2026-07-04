/**
 * douyin-recon.ts
 * 抖音团购对账 — 固定 T+6 偏移
 *
 * 银行入账日 = 企迈订单日 + 6 天
 * 校准（基于 293 笔银行入账 + 全期间订单数据）：
 *   T+3: 110.75% | T+4: 108.82% | T+5: 108.07% | T+6: 108.06% (最优)
 *
 * 整体银行入账 ≈ 抖音团购订单的 80%（20% 缺口来自抖音平台抽佣 + 退款 + 未到账尾部）
 */

export const DOUYIN_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;
export const DOUYIN_T_DEFAULT = 5;
export const DOUYIN_T_LOOKBACK_DAYS = 14;  // 抖音日结为主

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string | null;
  tOffset: number;
  store?: string | null;
}

export function buildDouyinDailyQuery(opts: ReconOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, incomeOds, periodEnd, tOffset, store } = opts;
  const params: unknown[] = [];
  const filterClauses: string[] = [];
  // Push tOffset FIRST so $$ references are stable
  params.push(tOffset);
  const tOffsetIdx = params.length;
  if (periodEnd) {
    params.push(periodEnd);
    filterClauses.push(`AND t.txn_time < $${params.length}::DATE`);
  }
  if (store && store !== 'all') {
    params.push(store);
    filterClauses.push(`AND t.store_code = $${params.length}`);
  }

  const sql = `
    WITH bank_douyin AS (
      SELECT
        txn_time::DATE AS bank_date,
        store_code,
        SUM(COALESCE(in_amt, 0)) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'DOUYIN'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
      GROUP BY txn_time::DATE, store_code
    ),
    qimai_daily AS (
      SELECT
        biz_date AS qimai_date,
        store_code,
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS qimai_amt
      FROM ${incomeOds}.income_detail
      WHERE payment_methods @> ARRAY['抖音团购券']::text[]
        AND NOT is_refund
        AND NOT is_member_payment
      GROUP BY biz_date, store_code
    )
    SELECT
      to_char(b.bank_date, 'YYYY-MM-DD')       AS bank_date_str,
      b.bank_amt,
      b.store_code,
      to_char(b.bank_date - $${tOffsetIdx}::int * INTERVAL '1 day', 'YYYY-MM-DD') AS qimai_date,
      COALESCE(q.order_count, 0)::int            AS qimai_count,
      COALESCE(q.qimai_amt, 0)::numeric          AS qimai_amt,
      b.bank_amt - COALESCE(q.qimai_amt, 0)      AS diff,
      CASE WHEN COALESCE(q.qimai_amt, 0) > 0
        THEN ROUND((b.bank_amt / q.qimai_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM bank_douyin b
    LEFT JOIN qimai_daily q
      ON q.qimai_date = b.bank_date - $${tOffsetIdx}::int * INTERVAL '1 day'
     AND q.store_code = b.store_code
    ORDER BY b.bank_date
  `;
  // No extra push — tOffset already in params[0]
  return [sql, params];
}
