// ui/src/lib/cycle-recon.ts
// Shared SQL helper for Tamkoko 支付宝+微信对账 (parent-company 苏州泰柯
// settlement). Used by /api/income/cycle-recon and MCP tools.
//
// Tamkoko's WeChat + Alipay orders first land in the parent company
// "苏州泰柯餐饮管理有限公司" with a T+x-day settle lag, then the parent
// periodically transfers funds to store accounts.
//
// Two kinds of bank entries — distinguished by summary/purpose regex:
//
//  ┌─ weekly  "周结" / "周" suffix ─────────────────────────────┐
//  │   pattern: (YYYY年)? M.D - M.D (周结|周)                    │
//  │   → declare explicit range [M.D, M.D]; no subtraction.      │
//  └────────────────────────────────────────────────────────────┘
//
//  ┌─ monthly top-up of leftover dates  "X月月结" ───────────────┐
//  │   pattern: (YYYY年)? X 月 月结                              │
//  │   → declared range [X月1日, X月末]                          │
//  │   → subtract dates already covered by an EARLIER weekly row │
//  │     in the same store, same year-month (txn_time < current).│
//  │   "月结"就是补齐周结没顾到的头尾。                          │
//  └────────────────────────────────────────────────────────────┘
//
// Notes:
// - Data reality: some early imports truncated summary at ~17 bytes
//   ("M.D-M.D周" without 结); later rows retained "周结"/"月结" full form.
//   Regex accepts both.
// - LAG-based fallback applies only when neither pattern matches (rare).

export interface BuildCycleQueryOpts {
  odsSchema: string;
  dmSchema: string;
  store?: string;
  periodEnd?: string | null;
  tOffset: number;
}

/**
 * Build a single SQL. Output columns:
 *   bank_date_str         — bank txn date (YYYY-MM-DD)
 *   bank_amt              — parent-company transfer amount
 *   window_kind           — 'weekly' / 'monthly' / 'fallback'
 *   window_start / _end   — effective Qimai date range after subtraction
 *   window_days           — end - start + 1, NULL if fully shadowed
 *   qimai_count / _amt    — matched Qimai WeChat+Alipay orders
 *   diff                  — bank_amt - qimai_amt
 *   entry_rate            — bank_amt / qimai_amt * 100
 *   summary               — original summary text (for UI)
 *   ref_year              — parsed year from summary
 *
 * Rows where the entire monthly window was already covered by earlier
 * weekly rows in the same month are dropped (window_start IS NOT NULL filter).
 */
export function buildCycleReconQuery(opts: BuildCycleQueryOpts): [string, unknown[]] {
  const { odsSchema, dmSchema, store, periodEnd, tOffset } = opts;
  const params: unknown[] = [];
  const filterClauses: string[] = [];

  params.push(tOffset);
  const tOffsetIdx = 1;
  let storeIdx: number | null = null;
  if (store && store !== 'all') {
    params.push(store);
    storeIdx = params.length;
    filterClauses.push(`AND t.store_code = $${storeIdx}`);
  }
  if (periodEnd) {
    params.push(periodEnd);
    const periodIdx = params.length;
    filterClauses.push(`AND t.txn_time < $${periodIdx}::DATE + INTERVAL '2 months'`);
    filterClauses.push(`AND t.txn_time >= $${periodIdx}::DATE - INTERVAL '3 months'`);
  }

  const sql = `
    WITH bank AS (
      SELECT
        t.id AS bank_txn_id,
        t.txn_time::DATE AS txn_date,
        t.in_amt,
        t.store_code,
        COALESCE(t.summary, t.purpose, '') AS s,
        -- ref_year: from "(YYYY年)" in summary OR fallback to txn_year
        COALESCE(
          SUBSTRING(COALESCE(t.summary, t.purpose, '') FROM '(20\\d{2})年')::int,
          EXTRACT(YEAR FROM t.txn_time)::int
        ) AS ref_year,
        -- kind classification
        CASE
          WHEN COALESCE(t.summary, t.purpose, '') ~ '(\\d{1,2})\\.(\\d{1,2})-(\\d{1,2})\\.(\\d{1,2})(周结|周)\$'
            OR COALESCE(t.summary, t.purpose, '') ~ '(\\d{1,2})\\.(\\d{1,2})-(\\d{1,2})\\.(\\d{1,2})(周结|周)\\D'
          THEN 'weekly'
          WHEN COALESCE(t.summary, t.purpose, '') ~ '(\\d{1,2})月月结'
          THEN 'monthly'
          ELSE 'fallback'
        END AS kind,
        -- weekly bounds
        SUBSTRING(COALESCE(t.summary, t.purpose, '') FROM '(\\d{1,2})\\.(\\d{1,2})-')::int
          AS w_mm1,
        SUBSTRING(COALESCE(t.summary, t.purpose, '') FROM '\\d{1,2}\\.(\\d{1,2})-')::int
          AS w_dd1,
        SUBSTRING(COALESCE(t.summary, t.purpose, '') FROM '-\\d{1,2}\\.(\\d{1,2})')::int
          AS w_dd2pre,
        SUBSTRING(COALESCE(t.summary, t.purpose, '') FROM '\\d{1,2}\\.\\d{1,2}-\\d{1,2}\\.(\\d{1,2})')::int
          AS w_dd2,
        -- monthly bound (X 月月结 → X)
        SUBSTRING(COALESCE(t.summary, t.purpose, '') FROM '(\\d{1,2})月月结')::int
          AS m_month,
        LAG(t.txn_time::DATE) OVER (
          PARTITION BY t.store_code ORDER BY t.txn_time
        ) AS prev_txn_date
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.classified_source IN ('rule', 'override')
        AND c.lvl1_code = 'REV_BIZ'
        AND c.lvl2_code IN ('WECHAT', 'ALIPAY')
        AND t.counterparty_name LIKE '%苏州泰柯餐饮管理有限公司%'
        AND t.in_amt > 0
        ${filterClauses.join('\n        ')}
    ),
    -- Flatten declared ranges into (txn_id, date_in_range) rows.
    expanded AS (
      SELECT
        bank_txn_id, txn_date, store_code, in_amt, s, kind, ref_year, prev_txn_date,
        gs::DATE AS biz_date
      FROM (
        -- weekly: [MM1.DD1, MM2.DD2]
        SELECT bank_txn_id, txn_date, store_code, in_amt, s, kind, ref_year, prev_txn_date,
               GENERATE_SERIES(
                 MAKE_DATE(ref_year, w_mm1, w_dd1),
                 MAKE_DATE(ref_year, w_mm1, w_dd2),
                 INTERVAL '1 day'
               ) AS gs
        FROM bank WHERE kind = 'weekly'
        UNION ALL
        -- monthly: [X月1日, X月末]
        SELECT bank_txn_id, txn_date, store_code, in_amt, s, kind, ref_year, prev_txn_date,
               GENERATE_SERIES(
                 MAKE_DATE(ref_year, m_month, 1),
                 (MAKE_DATE(ref_year, m_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
                 INTERVAL '1 day'
               ) AS gs
        FROM bank WHERE kind = 'monthly'
      ) src
    ),
    -- For MONTHLY rows, drop dates already covered by an earlier weekly row
    -- in the same store + same year-month. Weekly rows are never shadowed.
    covered AS (
      SELECT DISTINCT cur.bank_txn_id, cur.biz_date
      FROM expanded cur
      JOIN bank earlier
        ON earlier.kind = 'weekly'
       AND earlier.store_code = cur.store_code
       AND earlier.txn_date < cur.txn_date
       AND EXTRACT(YEAR  FROM earlier.txn_date) = EXTRACT(YEAR  FROM cur.biz_date)
       AND EXTRACT(MONTH FROM earlier.txn_date) = EXTRACT(MONTH FROM cur.biz_date)
       -- earlier weekly's declared range covers cur.biz_date exactly
       AND cur.biz_date >= MAKE_DATE(earlier.ref_year, earlier.w_mm1, earlier.w_dd1)
       AND cur.biz_date <= MAKE_DATE(earlier.ref_year, earlier.w_mm1, earlier.w_dd2)
      WHERE cur.kind = 'monthly'
    ),
    effective AS (
      -- Each row = one (bank_txn_id, biz_date) KEEPING the bank-level amounts
      SELECT
        e.bank_txn_id, e.txn_date AS bank_date, e.store_code, e.in_amt AS bank_amt,
        e.s AS summary, e.kind, e.ref_year, e.prev_txn_date, e.biz_date
      FROM expanded e
      LEFT JOIN covered c
        ON c.bank_txn_id = e.bank_txn_id AND c.biz_date = e.biz_date
      WHERE c.biz_date IS NULL
    ),
    declared_qimai AS (
      -- Qimai join for declared kinds (weekly + monthly). Per (txn_id, biz_date).
      SELECT
        ef.bank_txn_id,
        ef.bank_date,
        ef.store_code,
        ef.bank_amt,
        ef.summary,
        ef.kind,
        ef.ref_year,
        ef.prev_txn_date,
        COUNT(i.*)::int       AS qimai_count,
        COALESCE(SUM(i.net_amt), 0)::numeric AS qimai_total
      FROM effective ef
      LEFT JOIN ${odsSchema}.income_detail i
        ON i.store_code = ef.store_code
       AND i.biz_date = ef.biz_date
       AND NOT i.is_refund
       AND NOT i.is_member_payment
       AND (i.payment_methods @> ARRAY['微信支付']::text[]
            OR i.payment_methods @> ARRAY['支付宝支付']::text[])
      GROUP BY ef.bank_txn_id, ef.bank_date, ef.store_code, ef.bank_amt,
               ef.summary, ef.kind, ef.ref_year, ef.prev_txn_date
    ),
    -- Roll up to one row per bank_txn_id (collapse dates).
    rolled AS (
      SELECT
        q.bank_txn_id, q.bank_date, q.store_code, q.bank_amt,
        q.summary, q.kind, q.ref_year, q.prev_txn_date,
        SUM(q.qimai_count)::int              AS qimai_count,
        SUM(q.qimai_total)::numeric           AS qimai_total,
        MIN(e.biz_date) AS window_start,
        MAX(e.biz_date) AS window_end
      FROM declared_qimai q
      JOIN effective e
        ON e.bank_txn_id = q.bank_txn_id AND e.bank_amt = q.bank_amt
      GROUP BY q.bank_txn_id, q.bank_date, q.store_code, q.bank_amt,
               q.summary, q.kind, q.ref_year, q.prev_txn_date
    ),
    -- LAG fallback for rows with no parsed range (rare).
    fallback_qimai AS (
      SELECT
        b.bank_txn_id, b.txn_date AS bank_date, b.store_code, b.in_amt AS bank_amt,
        b.s AS summary, b.kind, b.ref_year, b.prev_txn_date,
        COUNT(i.*)::int       AS qimai_count,
        COALESCE(SUM(i.net_amt), 0)::numeric AS qimai_total,
        (b.txn_date - ($${tOffsetIdx}::int + 1))::DATE AS fallback_end,
        (COALESCE(b.prev_txn_date, b.txn_date - 10) - $${tOffsetIdx}::int)::DATE AS fallback_start
      FROM bank b
      LEFT JOIN ${odsSchema}.income_detail i
        ON i.store_code = b.store_code
       AND NOT i.is_refund
       AND NOT i.is_member_payment
       AND (i.payment_methods @> ARRAY['微信支付']::text[]
            OR i.payment_methods @> ARRAY['支付宝支付']::text[])
       AND i.biz_date BETWEEN
            (COALESCE(b.prev_txn_date, b.txn_date - 10) - $${tOffsetIdx}::int)::DATE
           AND (b.txn_date - ($${tOffsetIdx}::int + 1))::DATE
      WHERE b.kind = 'fallback'
      GROUP BY b.bank_txn_id, b.txn_date, b.store_code, b.in_amt,
               b.s, b.kind, b.ref_year, b.prev_txn_date
    ),
    -- For rows where the entire declared range was covered by earlier weekly
    -- rows in the same month (everything shadowed, no dates survived), drop
    -- them — there is nothing left to reconcile.
    effective_rows AS (
      SELECT
        bank_txn_id, bank_date, store_code, bank_amt,
        summary, kind, ref_year,
        window_start, window_end,
        qimai_count, qimai_total
      FROM rolled
      WHERE window_start IS NOT NULL
        AND window_end IS NOT NULL
    )
    SELECT
      to_char(bank_date, 'YYYY-MM-DD')              AS bank_date_str,
      bank_amt::numeric                              AS bank_amt,
      kind                                           AS window_kind,
      ref_year                                       AS ref_year,
      summary                                        AS summary,
      window_start                                   AS window_start,
      window_end                                     AS window_end,
      CASE
        WHEN window_start IS NULL OR window_end IS NULL THEN NULL
        ELSE (window_end - window_start + 1)::int
      END                                            AS window_days,
      COALESCE(qimai_count, 0)::int                  AS qimai_count,
      qimai_total                                    AS qimai_amt,
      (bank_amt - COALESCE(qimai_total, 0))::numeric AS diff,
      CASE WHEN qimai_total > 0
           THEN ROUND((bank_amt / qimai_total * 100)::numeric, 2)
           ELSE 0
      END                                            AS entry_rate
    FROM (
      SELECT * FROM effective_rows
      UNION ALL
      SELECT
        bank_txn_id, bank_date, store_code, bank_amt,
        summary, kind, ref_year,
        fallback_start AS window_start, fallback_end AS window_end,
        qimai_count, qimai_total
      FROM fallback_qimai
      WHERE bank_amt IS NOT NULL
    ) all_rows
    ORDER BY bank_date
  `;
  return [sql, params];
}

export const CYCLE_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;
