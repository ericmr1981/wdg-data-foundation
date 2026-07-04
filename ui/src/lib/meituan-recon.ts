/**
 * meituan-recon.ts
 * 美团外卖对账 — T+n 固定偏移窗口
 *
 * 排除规则（重要）：
 *   银行端: lvl2_code='MEITUAN' AND summary 不含 "团购"
 *   企迈端: payment_methods 含 "美团外卖支付" / "美团在线点单"
 *           AND NOT 含 "美团团购券"（团购券独立处理）
 *
 * 窗口算法: bank_date - T = qimai_biz_date
 *   即银行入账日 = 企迈订单日 + T 天
 */

export const MEITUAN_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;
export const MEITUAN_T_DEFAULT = 3;  // 经验默认值

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string | null;
  tOffset: number;
  store?: string | null;
}

export function buildMeituanDailyQuery(opts: ReconOpts): [string, unknown[]] {
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
    WITH bank_meituan AS (
      SELECT
        txn_time::DATE AS bank_date,
        store_code,
        SUM(COALESCE(in_amt, 0)) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'MEITUAN'
        AND c.classified_source IN ('rule', 'override')
        AND t.summary NOT LIKE '%团购%'
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
      WHERE (payment_methods @> ARRAY['美团外卖支付']::text[]
             OR payment_methods @> ARRAY['美团在线点单']::text[])
        AND NOT (payment_methods @> ARRAY['美团团购券']::text[])
      GROUP BY biz_date, store_code
    )
    SELECT
      to_char(b.bank_date, 'YYYY-MM-DD')            AS bank_date_str,
      b.bank_amt,
      b.store_code,
      to_char(b.bank_date - $${tOffsetIdx}::int * INTERVAL '1 day', 'YYYY-MM-DD')
        AS qimai_date,
      COALESCE(q.order_count, 0) AS qimai_count,
      COALESCE(q.qimai_amt, 0)::numeric AS qimai_amt,
      b.bank_amt - COALESCE(q.qimai_amt, 0) AS diff,
      CASE WHEN COALESCE(q.qimai_amt, 0) > 0
        THEN ROUND((b.bank_amt / q.qimai_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM bank_meituan b
    LEFT JOIN qimai_daily q
      ON q.qimai_date = b.bank_date - $${tOffsetIdx}::int * INTERVAL '1 day'
     AND q.store_code = b.store_code
    ORDER BY b.bank_date
  `;
  // No extra push — tOffset already in params[0]
  return [sql, params];
}
