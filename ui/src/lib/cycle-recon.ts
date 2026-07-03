// ui/src/lib/cycle-recon.ts
// Shared SQL helper for Tamkoko 支付宝+微信对账 (parent-company 苏州泰柯
// settlement cycle). Used by /api/income/cycle-recon and MCP tools.
//
// Use case: Tamkoko's WeChat + Alipay orders are first collected by the
// parent company "苏州泰柯餐饮管理有限公司", which then transfers funds
// to store accounts via periodic bank entries (周结每周, 月结每月).
//
// Algorithm: **摘要月份窗口法**
//
// 每笔银行流水的 summary（摘要）字段标注了对应的结算期间，如 "4月月结"
// 或 "2024年4月月结"。如果摘要包含月份信息，则窗口为该月月末最后 7 天
// （月结通常在月末批量划转）；如果摘要无月份信息（如 "周结" 或其他摘要），
// 则回退到 LAG-based 窗口（与前一笔 txn_time 间距推算）。
//
//   summary 含月份 → window_end   = 该月最后一天（月末）
//                     window_start = 该月最后 7 天（月末-6 天）
//                     （如 "4月月结" → 窗口为 4月24日~4月30日）
//   summary 无月份 → window_end   = current_txn - (tOffset + 1) days
//                     window_start = prev_txn    - tOffset days
//                     first entry  → fallback: current_txn - 10 days
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
 * Alipay orders. Window logic:
 * - If summary has "X月" → month-end window (last 7 days of referenced month)
 * - Otherwise → LAG-based window (fallback)
 * Returns rows like:
 *   { bank_date, bank_amt, window_days, qimai_count, qimai_amt, diff, entry_rate, ref_period }
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
        t.summary,
        LAG(t.txn_time) OVER (PARTITION BY t.store_code ORDER BY t.txn_time) AS prev_txn_time,
        -- Parse referenced month from summary (e.g. "4月月结" → 4)
        CASE
          WHEN t.summary ~ '_(\d+)月'     THEN SUBSTRING(t.summary FROM '_(\d+)月')::int
          WHEN t.summary ~ '(\d{1,2})月月结' THEN SUBSTRING(t.summary FROM '(\d{1,2})月月结')::int
          WHEN t.summary ~ '(\d{1,2})月'    THEN SUBSTRING(t.summary FROM '(\d{1,2})月')::int
          ELSE NULL
        END AS ref_month,
        -- Parse year from summary (e.g. "2024年4月" → 2024), fallback to txn_time year
        COALESCE(
          SUBSTRING(t.summary FROM '(\d{4})年')::int,
          EXTRACT(YEAR FROM t.txn_time)::int
        ) AS ref_year
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
        summary,
        ref_month,
        CASE
          -- 摘要含月份 → 使用该月月末窗口
          WHEN ref_month IS NOT NULL THEN
            (MAKE_DATE(ref_year, ref_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
          -- 无月份信息 → 回退 LAG-based
          ELSE
            (txn_time - ($1::int + 1) * INTERVAL '1 day')::DATE
        END AS window_end,
        CASE
          WHEN ref_month IS NOT NULL THEN
            (MAKE_DATE(ref_year, ref_month, 1) + INTERVAL '1 month' - INTERVAL '7 days')::DATE
          ELSE
            (COALESCE(prev_txn_time, txn_time - INTERVAL '10 days')::DATE - $1::int * INTERVAL '1 day')::DATE
        END AS window_start
      FROM txs
    ),
    qimai_in_window AS (
      SELECT
        w.bank_txn_id,
        w.txn_time,
        w.in_amt AS bank_amt,
        w.window_start,
        w.window_end,
        w.ref_month,
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
      GROUP BY w.bank_txn_id, w.txn_time, w.in_amt, w.window_start, w.window_end, w.ref_month
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
      END AS entry_rate,
      CASE WHEN ref_month IS NOT NULL
           THEN ref_year || '年' || ref_month || '月'
           ELSE NULL
      END AS ref_period
    FROM qimai_in_window
    ORDER BY txn_time
  `;
  return [sql, params];
}

export const CYCLE_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;