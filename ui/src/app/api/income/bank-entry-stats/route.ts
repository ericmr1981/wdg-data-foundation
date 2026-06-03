import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema, getCfgSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';

export const dynamic = 'force-dynamic';

// GET /api/income/bank-entry-stats?brand=gelatomiiix&period=2026-04&span=month
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand');
    const period = searchParams.get('period');
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || '';

    if (!brandParam) {
      return NextResponse.json({ success: false, error: 'brand required' }, { status: 400 });
    }

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const dmSchema = getDmSchema(brand);
    // Legacy brands (gelatomiiix) store income_detail in non-prefixed schema
    const incomeOds = brand === 'gelatomiiix' ? 'gelatomiiix_ods' : odsSchema;
    const cfgSchema = getCfgSchema(brand);

    const hasPeriod = period && period !== 'all';
    let dateClause = '';
    let bankDateClause = '';
    let unmatchedDateClause = '';
    let storeClause = '';
    let bankStoreClause = '';
    let params: (string | number)[] = [];
    let umParams: (string | number)[] = [];
    let currMonthDateClause = '1=0';
    let currMonthBankDateClause = '1=0';
    let currParams: (string | number)[] = [];
    if (store && store !== 'all') {
      params.push(store);
      umParams.push(store);
      storeClause = 'AND store_code = $1';
      bankStoreClause = 'AND t.store_code = $1';
    }
    if (hasPeriod) {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'Invalid period format for span' }, { status: 400 });
      }
      const [periodStart, periodEnd] = range;
      const periodEndInclusive = new Date(new Date(periodEnd + 'T00:00:00').getTime() - 86400000)
        .toISOString().slice(0, 10);
      const dn = store && store !== 'all' ? 2 : 1;
      params.push(periodEnd);
      dateClause = `AND biz_date < $${dn}::DATE`;
      bankDateClause = `AND t.txn_time < $${dn}::DATE`;
      umParams.push(periodStart, periodEndInclusive);
      unmatchedDateClause = `AND biz_date >= $${store && store !== 'all' ? 2 : 1}::DATE AND biz_date <= $${store && store !== 'all' ? 3 : 2}::DATE`;
      currParams.push(periodStart, periodEnd);
      if (store && store !== 'all') {
        currMonthDateClause = `AND biz_date >= $1::DATE AND biz_date < $2::DATE AND store_code = $3`;
        currMonthBankDateClause = `AND t.txn_time >= $1::DATE AND t.txn_time < $2::DATE AND t.store_code = $3`;
        currParams.push(store);
      } else {
        currMonthDateClause = `AND biz_date >= $1::DATE AND biz_date < $2::DATE`;
        currMonthBankDateClause = `AND t.txn_time >= $1::DATE AND t.txn_time < $2::DATE`;
      }
    }

    // --- channelMetrics (qimai income from income_detail) ---
    const channelMetricsResult = await pool.query(`
      SELECT
        COALESCE(
          (SELECT m.channel_code FROM ${cfgSchema}.channel_mapping m WHERE m.payment_method = ANY(payment_methods) ORDER BY m.sort_order LIMIT 1),
          'OTHER'
        ) AS channel,
        COALESCE(SUM(net_amt), 0) AS qimai_net_amt
      FROM ${incomeOds}.income_detail
      WHERE NOT is_refund
        AND NOT is_member_payment
        ${dateClause} ${storeClause}
      GROUP BY 1
      ORDER BY 1
    `, params);

    // --- bank entry by channel (使用预分类快照) ---
    const bankEntryResult = await pool.query(`
      SELECT
        c.lvl2_code AS channel,
        COALESCE(SUM(COALESCE(t.in_amt, 0)), 0) AS bank_entry_amt
      FROM ${odsSchema}.bank_txn t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.classified_source IN ('rule', 'override')
        AND c.lvl1_code = 'REV_BIZ'
        AND c.lvl2_code NOT IN ('OTHER_CH', 'REFUND_IN')
        AND COALESCE(t.in_amt, 0) > 0
        ${bankDateClause} ${bankStoreClause}
      GROUP BY c.lvl2_code
    `, params);

    // --- current month channel data ---
    let currBankByChannel = new Map<string, number>();
    let currQimaiByChannel = new Map<string, number>();
    if (hasPeriod) {
      const [currBankRes, currQimaiRes] = await Promise.all([
        pool.query(`
          SELECT c.lvl2_code AS channel,
                 COALESCE(SUM(COALESCE(t.in_amt, 0)), 0) AS bank_entry_amt
          FROM ${odsSchema}.bank_txn t
          JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
          WHERE c.classified_source IN ('rule', 'override')
            AND c.lvl1_code = 'REV_BIZ'
            AND c.lvl2_code NOT IN ('OTHER_CH', 'REFUND_IN')
            AND COALESCE(t.in_amt, 0) > 0
            ${currMonthBankDateClause}
          GROUP BY c.lvl2_code
        `, currParams),
        pool.query(`
          SELECT
            COALESCE(
              (SELECT m.channel_code FROM ${cfgSchema}.channel_mapping m WHERE m.payment_method = ANY(payment_methods) ORDER BY m.sort_order LIMIT 1),
              'OTHER'
            ) AS channel,
            COALESCE(SUM(net_amt), 0) AS qimai_net_amt
          FROM ${incomeOds}.income_detail
          WHERE NOT is_refund AND NOT is_member_payment
            ${currMonthDateClause}
          GROUP BY 1
        `, currParams)
      ]);
      for (const row of currBankRes.rows as { channel: string; bank_entry_amt: string }[]) {
        currBankByChannel.set(row.channel, parseFloat(row.bank_entry_amt));
      }
      for (const row of currQimaiRes.rows as { channel: string; qimai_net_amt: string }[]) {
        currQimaiByChannel.set(row.channel, parseFloat(row.qimai_net_amt));
      }
    }

    // --- monthlyTrend ---
    let trendDateClause = '';
    if (hasPeriod) {
      const [ps, pe] = parsePeriod(period, span)!;
      trendDateClause = `AND biz_date < '${pe}'::DATE`;
    }

    const st = store ? store.replace(/'/g, "''") : '';
    const trendStore = store && store !== 'all' ? `AND store_code = '${st}'` : '';
    const monthlyTrendResult = await pool.query(`
      WITH qimai_monthly AS (
        SELECT to_char(biz_date, 'YYYY-MM') AS month, SUM(net_amt) AS qimai_net_amt
        FROM ${incomeOds}.income_detail
        WHERE NOT is_refund AND NOT is_member_payment ${trendDateClause} ${trendStore}
        GROUP BY 1
      ),
      bank_monthly AS (
        SELECT to_char(t.txn_time, 'YYYY-MM') AS month, SUM(COALESCE(t.in_amt, 0)) AS bank_entry_amt
        FROM ${odsSchema}.bank_txn t
        JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
        WHERE c.classified_source IN ('rule', 'override')
          AND c.lvl1_code = 'REV_BIZ'
          AND c.lvl2_code NOT IN ('OTHER_CH', 'REFUND_IN')
          AND COALESCE(t.in_amt, 0) > 0
        GROUP BY 1
      )
      SELECT COALESCE(q.month, b.month) AS month,
             COALESCE(q.qimai_net_amt, 0) AS qimai_net_amt,
             COALESCE(b.bank_entry_amt, 0) AS bank_entry_amt
      FROM qimai_monthly q FULL OUTER JOIN bank_monthly b ON q.month = b.month
      ORDER BY 1
    `);

    // --- unmatchedOrders ---
    const unmatchedOrdersResult = await pool.query(`
      SELECT
        to_char(biz_date, 'YYYY-MM') AS month,
        COALESCE(
          (SELECT m.channel_code FROM ${cfgSchema}.channel_mapping m WHERE m.payment_method = ANY(payment_methods) ORDER BY m.sort_order LIMIT 1),
          'OTHER'
        ) AS channel,
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS unentered_amt
      FROM ${incomeOds}.income_detail
      WHERE third_party_txn_no IS NULL
        AND NOT is_refund
        AND NOT is_member_payment
        ${unmatchedDateClause} ${storeClause}
      GROUP BY month, channel
      ORDER BY month DESC, channel
    `, umParams);

    // Build channel metrics
    const qimaiByChannel = new Map<string, number>();
    for (const row of channelMetricsResult.rows as { channel: string; qimai_net_amt: string }[]) {
      qimaiByChannel.set(row.channel, parseFloat(row.qimai_net_amt));
    }
    const bankByChannel = new Map<string, number>();
    for (const row of bankEntryResult.rows as { channel: string; bank_entry_amt: string }[]) {
      bankByChannel.set(row.channel, parseFloat(row.bank_entry_amt));
    }

    const allChannels = new Set([...qimaiByChannel.keys(), ...bankByChannel.keys()]);
    const channelMetrics = [];
    let totalQimai = 0;
    let totalBank = 0;
    let totalCurrQimai = 0;
    let totalCurrBank = 0;

    for (const channel of allChannels) {
      const qimaiAmt = qimaiByChannel.get(channel) || 0;
      const bankAmt = bankByChannel.get(channel) || 0;
      const currQimaiAmt = currQimaiByChannel.get(channel) || 0;
      const currBankAmt = currBankByChannel.get(channel) || 0;
      totalQimai += qimaiAmt;
      totalBank += bankAmt;
      totalCurrQimai += currQimaiAmt;
      totalCurrBank += currBankAmt;
      channelMetrics.push({
        channel,
        qimai_net_amt: qimaiAmt.toFixed(2),
        bank_entry_amt: bankAmt.toFixed(2),
        entry_rate: qimaiAmt > 0 ? (bankAmt / qimaiAmt * 100).toFixed(2) : '0.00',
        month_qimai_amt: currQimaiAmt.toFixed(2),
        month_bank_amt: currBankAmt.toFixed(2),
      });
    }

    channelMetrics.push({
      channel: 'TOTAL',
      qimai_net_amt: totalQimai.toFixed(2),
      bank_entry_amt: totalBank.toFixed(2),
      entry_rate: totalQimai > 0 ? (totalBank / totalQimai * 100).toFixed(2) : '0.00',
      month_qimai_amt: totalCurrQimai.toFixed(2),
      month_bank_amt: totalCurrBank.toFixed(2),
    });

    const monthlyTrend = (monthlyTrendResult.rows as { month: string; qimai_net_amt: string; bank_entry_amt: string }[])
      .map(r => ({
        month: r.month,
        qimai_net_amt: parseFloat(r.qimai_net_amt).toFixed(2),
        bank_entry_amt: parseFloat(r.bank_entry_amt).toFixed(2),
      }));

    const unmatchedOrders = (unmatchedOrdersResult.rows as { month: string; channel: string; order_count: string; unentered_amt: string }[])
      .map(r => ({
        month: r.month,
        channel: r.channel,
        order_count: r.order_count,
        unentered_amt: parseFloat(r.unentered_amt).toFixed(2),
      }));

    return NextResponse.json({ success: true, data: { channelMetrics, monthlyTrend, unmatchedOrders } });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
