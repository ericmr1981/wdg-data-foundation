/**
 * meituan-tuangou-recon.ts
 * 美团团购券对账 — 连续窗口 + T+5 滑动
 *
 * 算法（参考淘宝闪购，但入账延迟为 T+5 而非 T+3）:
 *   raw window = [prev_bank_date, bank_date - 1]  (连续无间隔)
 *   qimai window = raw window 整体前移 T+5 天
 *   业务上：入账不规律（按笔/天，周节），但平均延迟是 5 天
 *
 * 排除规则:
 *   银行端: summary LIKE '%团购%' AND lvl2_code='MEITUAN'
 *   企迈端: payment_methods 含 "美团团购券"（不与其他渠道混）
 */

export const MEITUAN_TUANGOU_T_DEFAULT = 5;
export const MEITUAN_TUANGOU_LOOKBACK_DAYS = 60;

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
    WITH bank_tuangou AS (
      SELECT
        t.id, t.store_code, t.txn_time::DATE AS bank_date, COALESCE(t.in_amt, 0) AS bank_amt,
        LAG(t.txn_time::DATE) OVER (PARTITION BY t.store_code ORDER BY t.txn_time) AS prev_date
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE t.summary LIKE '%团购%'
        AND c.lvl2_code = 'MEITUAN'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
    ),
    raw_window AS (
      SELECT
        id, store_code, bank_date, bank_amt, prev_date,
        (bank_date - 1)::DATE                                                                 AS w_end_raw,
        COALESCE(prev_date, bank_date - INTERVAL '${MEITUAN_TUANGOU_LOOKBACK_DAYS} days')::DATE   AS w_start_raw
      FROM bank_tuangou
    ),
    qimai_window AS (
      SELECT
        id, store_code, bank_date, bank_amt, prev_date, w_end_raw, w_start_raw,
        (w_end_raw   - $${tOffsetIdx}::int) AS qimai_end,
        (w_start_raw - $${tOffsetIdx}::int) AS qimai_start
      FROM raw_window
    )
    SELECT
      to_char(qw.bank_date, 'YYYY-MM-DD')            AS bank_date_str,
      qw.bank_amt,
      qw.store_code,
      to_char(qw.qimai_start, 'YYYY-MM-DD') || ' ~ ' || to_char(qw.qimai_end, 'YYYY-MM-DD') AS qimai_window,
      GREATEST(0, (qw.qimai_end - qw.qimai_start + 1))::int AS window_days,
      COALESCE(qi.qimai_count, 0)::int               AS qimai_count,
      COALESCE(qi.qimai_total, 0)::numeric           AS qimai_total,
      qw.bank_amt - COALESCE(qi.qimai_total, 0)     AS diff,
      CASE WHEN COALESCE(qi.qimai_total, 0) > 0
        THEN ROUND((qw.bank_amt / qi.qimai_total * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM qimai_window qw
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS qimai_count,
        COALESCE(SUM(net_amt), 0) AS qimai_total
      FROM ${incomeOds}.income_detail q
      WHERE q.store_code = qw.store_code
        AND q.biz_date BETWEEN qw.qimai_start AND qw.qimai_end
        AND NOT q.is_refund
        AND NOT q.is_member_payment
        AND q.payment_methods @> ARRAY['美团团购券']::text[]
    ) qi ON true
    ORDER BY qw.bank_date
  `;
  return [sql, params];
}
