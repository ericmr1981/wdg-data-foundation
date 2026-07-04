/**
 * taobao-recon.ts
 * 淘宝闪购对账 — 连续滑动窗口
 *
 * 步骤 1: 基于银行入账时间计算原始窗口
 *         w_end_raw = bank_date - 1
 *         w_start_raw = prev_bank_date (or bank_date - 60 for first entry)
 *   这样多个相邻窗口首尾衔接 (无重叠, 无间隙), 覆盖整个打款周期。
 *
 * 步骤 2: 窗口往前平移 T_PLUS_X 天, 得到 qimai 订单日期范围。
 *   因为订单要先到母公司 (T+x 天延迟), 然后母公司打款到门店。
 *   qimai_start = w_start_raw - T_PLUS_X
 *   qimai_end   = w_end_raw   - T_PLUS_X
 *
 * 步骤 3: 在该 qimai 范围内统计 该门店 的 淘宝闪购订单 (net_amt sum).
 *
 * T_PLUS_X 硬编码 3 天 (淘宝商户日结典型 T+1~T+5 范围中位).
 */

export const TAOBAO_RECON_SUPPORTED_BRANDS = ['tamkoko'] as const;

export const TAOBAO_T_PLUS_X = 3;       // 订单到账延迟 (天)
export const TAOBAO_INITIAL_LOOKBACK_DAYS = 60;  // 首批数据最多回看天数
export const TAOBAO_T_DEFAULT = 3;       // T+N 日汇总默认偏移

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
        t.id, t.store_code, t.txn_time::DATE AS bank_date, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'TAOBAO'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
    ),
    -- Sorted per store; LAG gives previous bank_date in same store
    bank_ordered AS (
      SELECT
        id, store_code, bank_date, bank_amt,
        LAG(bank_date) OVER (PARTITION BY store_code ORDER BY bank_date) AS prev_bank_date
      FROM bank_dedup
    ),
    -- Step 1: 连续的"结算周期窗口 (银行入账维度)"
    raw_window AS (
      SELECT
        id, store_code, bank_date, bank_amt, prev_bank_date,
        (bank_date - 1)                                     AS w_end_raw,
        COALESCE(prev_bank_date, bank_date - ${TAOBAO_INITIAL_LOOKBACK_DAYS})::DATE  AS w_start_raw
      FROM bank_ordered
    ),
    -- Step 2: 窗口整体向前平移 T_PLUS_X 天, 得到实际的企迈订单日期范围
    qimai_window AS (
      SELECT
        id, store_code, bank_date, bank_amt, prev_bank_date, w_end_raw, w_start_raw,
        (w_end_raw   - ${TAOBAO_T_PLUS_X})::DATE                       AS qimai_end,
        (w_start_raw - ${TAOBAO_T_PLUS_X})::DATE                       AS qimai_start
      FROM raw_window
    )
    SELECT
      to_char(w.bank_date, 'YYYY-MM-DD')                    AS bank_date_str,
      w.bank_amt,
      to_char(w.qimai_start, 'YYYY-MM-DD') || ' ~ '
        || to_char(w.qimai_end, 'YYYY-MM-DD')                AS qimai_window,
      GREATEST(0, w.qimai_end - w.qimai_start + 1)::int      AS window_days,
      COALESCE(qi.qimai_count, 0)::int                       AS qimai_count,
      COALESCE(qi.qimai_total, 0)::numeric                   AS qimai_total,
      w.bank_amt - COALESCE(qi.qimai_total, 0)               AS diff,
      CASE WHEN COALESCE(qi.qimai_total, 0) > 0
        THEN ROUND((w.bank_amt / qi.qimai_total * 100)::numeric, 2)
        ELSE 0
      END                                                   AS entry_rate
    FROM qimai_window w
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)              AS qimai_count,
        COALESCE(SUM(net_amt), 0) AS qimai_total
      FROM ${incomeOds}.income_detail q
      WHERE q.store_code = w.store_code
        AND q.biz_date BETWEEN w.qimai_start AND w.qimai_end
        AND NOT q.is_refund
        AND NOT q.is_member_payment
        AND (q.payment_methods @> ARRAY['淘宝闪购支付']::text[]
             OR q.biz_source = '淘宝闪购')
    ) qi ON true
    ORDER BY w.bank_date
  `;
  return [sql, params];
}

/**
 * buildTaobaoDailyQuery
 * 淘宝闪购对账 — T+N 日汇总模式（适用于世纪汇等店）
 *
 * 窗口算法: bank_date - T = qimai_biz_date
 *   即银行入账日 = 企迈订单日 + T 天
 */
export function buildTaobaoDailyQuery(opts: ReconOpts & { tOffset: number }): [string, unknown[]] {
  const { odsSchema, dmSchema, incomeOds, periodEnd, tOffset, store } = opts;
  const params: unknown[] = [];
  const filterClauses: string[] = [];
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
    WITH bank_taobao AS (
      SELECT
        txn_time::DATE AS bank_date,
        store_code,
        SUM(COALESCE(in_amt, 0)) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'TAOBAO'
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
      WHERE (payment_methods @> ARRAY['淘宝闪购支付']::text[]
             OR biz_source = '淘宝闪购')
        AND NOT is_refund
        AND NOT is_member_payment
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
      NULL::text AS qimai_window,
      NULL::int AS window_days,
      b.bank_amt - COALESCE(q.qimai_amt, 0) AS diff,
      CASE WHEN COALESCE(q.qimai_amt, 0) > 0
        THEN ROUND((b.bank_amt / q.qimai_amt * 100)::numeric, 2)
        ELSE 0
      END AS entry_rate,
      'daily' AS _rmode
    FROM bank_taobao b
    LEFT JOIN qimai_daily q
      ON q.qimai_date = b.bank_date - $${tOffsetIdx}::int * INTERVAL '1 day'
     AND q.store_code = b.store_code
    ORDER BY b.bank_date
  `;
  return [sql, params];
}

/**
 * buildTaobaoHybridQuery
 * 淘宝闪购对账 — LAG(旧) + T+N(新) 混合模式
 *
 * 适用于富阳店: 6/16 前周结走 LAG 滑动窗口, 6/16 后日结走 T+N.
 *
 * 两条子查询 UNION ALL, 结果统一按 bank_date 排序, 每行带 _rmode 标识来源。
 */
export function buildTaobaoHybridQuery(opts: ReconOpts & { tOffset: number; cutoffDate: string }): [string, unknown[]] {
  const { odsSchema, dmSchema, incomeOds, periodEnd, tOffset, store, cutoffDate } = opts;
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

  params.push(tOffset);
  const tIdx = params.length;
  params.push(cutoffDate);
  const cutoffIdx = params.length;

  const sql = `
    WITH bank_dedup AS (
      SELECT DISTINCT ON (t.id)
        t.id, t.store_code, t.txn_time::DATE AS bank_date, COALESCE(t.in_amt, 0) AS bank_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.lvl2_code = 'TAOBAO'
        AND c.classified_source IN ('rule', 'override')
        ${filterClauses.join('\n        ')}
    ),
    -- 6/16 前: LAG 滑动窗口
    lag_part AS (
      SELECT * FROM (
        SELECT
          b.bank_date, b.bank_amt, b.store_code,
          NULL::text AS qimai_date,
          to_char(
            COALESCE(b.prev_bank_date, b.bank_date - ${TAOBAO_INITIAL_LOOKBACK_DAYS})::DATE - ${TAOBAO_T_PLUS_X}
            , 'YYYY-MM-DD') || ' ~ ' ||
          to_char((b.bank_date - 1) - ${TAOBAO_T_PLUS_X}, 'YYYY-MM-DD') AS qimai_window,
          GREATEST(0, (b.bank_date - 1) - ${TAOBAO_T_PLUS_X} - (COALESCE(b.prev_bank_date, b.bank_date - ${TAOBAO_INITIAL_LOOKBACK_DAYS})::DATE - ${TAOBAO_T_PLUS_X}) + 1)::int AS window_days,
          qi.qimai_count, qi.qimai_total AS qimai_amt,
          b.bank_amt - COALESCE(qi.qimai_total, 0) AS diff,
          CASE WHEN COALESCE(qi.qimai_total, 0) > 0
            THEN ROUND((b.bank_amt / qi.qimai_total * 100)::numeric, 2)
            ELSE 0
          END AS entry_rate,
          'lag' AS _rmode
        FROM (
          SELECT
            bank_date, bank_amt, store_code,
            LAG(bank_date) OVER (PARTITION BY store_code ORDER BY bank_date) AS prev_bank_date
          FROM bank_dedup
          WHERE bank_date < $${cutoffIdx}::DATE
        ) b
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS qimai_count,
            COALESCE(SUM(net_amt), 0) AS qimai_total
          FROM ${incomeOds}.income_detail q
          WHERE q.store_code = b.store_code
            AND q.biz_date BETWEEN
                COALESCE(b.prev_bank_date, b.bank_date - ${TAOBAO_INITIAL_LOOKBACK_DAYS})::DATE - ${TAOBAO_T_PLUS_X}
                AND (b.bank_date - 1) - ${TAOBAO_T_PLUS_X}
            AND NOT q.is_refund
            AND NOT q.is_member_payment
            AND (q.payment_methods @> ARRAY['淘宝闪购支付']::text[]
                 OR q.biz_source = '淘宝闪购')
        ) qi ON true
      ) sub
    ),
    -- 6/16 起: T+N 日汇总
    daily_part AS (
      SELECT
        b.bank_date,
        SUM(b.bank_amt) AS bank_amt,
        b.store_code,
        to_char(b.bank_date - $${tIdx}::int, 'YYYY-MM-DD') AS qimai_date,
        NULL::text AS qimai_window,
        NULL::int AS window_days,
        COALESCE(q.qimai_count, 0)::int AS qimai_count,
        COALESCE(q.qimai_amt, 0)::numeric AS qimai_amt,
        SUM(b.bank_amt) - COALESCE(q.qimai_amt, 0) AS diff,
        CASE WHEN COALESCE(q.qimai_amt, 0) > 0
          THEN ROUND((SUM(b.bank_amt) / q.qimai_amt * 100)::numeric, 2)
          ELSE 0
        END AS entry_rate,
        'daily' AS _rmode
      FROM (
        SELECT txn_time::DATE AS bank_date, store_code, SUM(COALESCE(in_amt, 0)) AS bank_amt
        FROM ${odsSchema}.bank_txn t
        JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
        WHERE c.lvl2_code = 'TAOBAO'
          AND c.classified_source IN ('rule', 'override')
          AND t.txn_time::DATE >= $${cutoffIdx}::DATE
          ${filterClauses.join('\n          ')}
        GROUP BY txn_time::DATE, store_code
      ) b
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS qimai_count,
          COALESCE(SUM(net_amt), 0) AS qimai_amt
        FROM ${incomeOds}.income_detail q
        WHERE q.store_code = b.store_code
          AND q.biz_date = b.bank_date - $${tIdx}::int
          AND NOT q.is_refund
          AND NOT q.is_member_payment
          AND (q.payment_methods @> ARRAY['淘宝闪购支付']::text[]
               OR q.biz_source = '淘宝闪购')
      ) q ON true
      GROUP BY b.bank_date, b.store_code, q.qimai_count, q.qimai_amt
    )
    SELECT
      to_char(bank_date, 'YYYY-MM-DD') AS bank_date_str,
      bank_amt, store_code,
      qimai_date, qimai_window, window_days,
      qimai_count, qimai_amt, diff, entry_rate,
      _rmode
    FROM lag_part
    UNION ALL
    SELECT
      to_char(bank_date, 'YYYY-MM-DD') AS bank_date_str,
      bank_amt, store_code,
      qimai_date, qimai_window, window_days,
      qimai_count, qimai_amt, diff, entry_rate,
      _rmode
    FROM daily_part
    ORDER BY bank_date_str
  `;
  return [sql, params];
}
