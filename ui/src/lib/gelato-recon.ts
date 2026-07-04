/**
 * gelato-recon.ts
 * 蜜可诗 (Gelatomiiix) 对账 — 微信支付固定 T+1，支付宝 LAG 窗口匹配
 */

export const GELATO_RECON_SUPPORTED_BRANDS = ['gelatomiiix'];
export const GELATO_T_DEFAULT = 1;          // 微信 T+1
export const GELATO_ALIPAY_T_OFFSET = 4;   // 支付宝 T+4 (window_end = bank_date - 4)
export const GELATO_ALIPAY_LOOKBACK_DAYS = 30;

export interface ReconOpts {
  odsSchema: string;
  dmSchema: string;
  incomeOds: string;
  periodEnd: string | null;
  tOffset: number;
  store?: string | null;
}

/**
 * 微信支付对账（固定 T+1 偏移）
 * gelatomiiix 的 income ODS 使用 legacy schema: gelatomiiix_ods
 */
export function buildGelatoWechatQuery(opts: ReconOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, periodEnd, tOffset, store } = opts;
  const INCOME_ODS = 'gelatomiiix_ods';
  const params: unknown[] = [];
  // Push tOffset FIRST so $$ for window_end references the right index
  params.push(tOffset);
  const tOffsetIdx = params.length;
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
    WITH bank_wechat AS (
      SELECT
        txn_time::DATE AS bank_date,
        store_code,
        SUM(COALESCE(in_amt, 0)) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'WECHAT'
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
      FROM ${INCOME_ODS}.income_detail
      WHERE payment_methods @> ARRAY['微信支付']
      GROUP BY biz_date, store_code
    )
    SELECT
      to_char(b.bank_date, 'YYYY-MM-DD')        AS bank_date_str,
      b.bank_amt,
      b.store_code,
      to_char((b.bank_date - make_interval(days => $${tOffsetIdx}))::DATE, 'YYYY-MM-DD') AS qimai_date,
      COALESCE(q.order_count, 0)::int            AS qimai_count,
      COALESCE(q.qimai_amt, 0)::numeric          AS qimai_amt,
      b.bank_amt - COALESCE(q.qimai_amt, 0)      AS diff,
      CASE WHEN COALESCE(q.qimai_amt, 0) > 0
        THEN ROUND((b.bank_amt / q.qimai_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM bank_wechat b
    LEFT JOIN qimai_daily q
      ON q.qimai_date = (b.bank_date - make_interval(days => $${tOffsetIdx}))::DATE
     AND q.store_code = b.store_code
    ORDER BY b.bank_date
  `;
  return [sql, params];
}

/**
 * 支付宝对账（LAG 窗口匹配模式）
 * gelatomiiix 的 income ODS 使用 legacy schema: gelatomiiix_ods
 * 第一笔打款的回退窗口为 30 天
 */
export function buildGelatoAlipayQuery(opts: ReconOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, periodEnd, tOffset, store } = opts;
  const INCOME_ODS = 'gelatomiiix_ods';
  const params: unknown[] = [];
  // Push tOffset FIRST so we can use $$ for the window_end/left_outer places
  params.push(tOffset);
  const tOffsetIdx = params.length;
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
    WITH bank_alipay AS (
      SELECT
        t.id, t.store_code, t.txn_time, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'ALIPAY'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
    ),
    windows AS (
      SELECT
        b.id, b.store_code, b.txn_time, b.bank_amt,
        LAG(b.txn_time) OVER (PARTITION BY b.store_code ORDER BY b.txn_time) AS prev_txn_time,
        ((b.txn_time) - make_interval(days => $${tOffsetIdx}))::DATE AS window_end
      FROM bank_alipay b
    ),
    windows_final AS (
      SELECT
        w.id, w.store_code, w.txn_time::DATE AS bank_date, w.bank_amt,
        w.window_end,
        COALESCE(w.prev_txn_time::DATE, (w.txn_time::DATE - INTERVAL '${GELATO_ALIPAY_LOOKBACK_DAYS} days')::DATE) AS window_start
      FROM windows w
    )
    SELECT
      to_char(wf.bank_date, 'YYYY-MM-DD')                                            AS bank_date_str,
      wf.bank_amt,
      wf.store_code,
      to_char(wf.window_start, 'YYYY-MM-DD') || ' ~ ' || to_char(wf.window_end, 'YYYY-MM-DD') AS qimai_window,
      GREATEST(0, wf.window_end - wf.window_start + 1)::int                          AS window_days,
      COALESCE(qi.order_count, 0)::int                                              AS qimai_count,
      COALESCE(qi.total_amt, 0)::numeric                                            AS qimai_total,
      wf.bank_amt - COALESCE(qi.total_amt, 0)                                        AS diff,
      CASE WHEN COALESCE(qi.total_amt, 0) > 0
        THEN ROUND((wf.bank_amt / qi.total_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate
    FROM windows_final wf
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS total_amt
      FROM ${INCOME_ODS}.income_detail q
      WHERE q.store_code = wf.store_code
        AND q.payment_methods @> ARRAY['支付宝支付']
        AND q.biz_date >= wf.window_start
        AND q.biz_date <= wf.window_end
    ) qi ON true
    ORDER BY wf.bank_date
  `;
  return [sql, params];
}
