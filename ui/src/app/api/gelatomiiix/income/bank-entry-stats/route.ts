import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';

export const dynamic = 'force-dynamic';

// GET /api/gelatomiiix/income/bank-entry-stats?brand=gelatomiiix&period=2026-04&span=month
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    const period = searchParams.get('period');
    const span = searchParams.get('span') || 'month';

    if (!brand || !period) {
      return NextResponse.json({ success: false, error: 'brand and period required' }, { status: 400 });
    }

    const range = parsePeriod(period, span);
    if (!range) {
      return NextResponse.json({ success: false, error: 'Invalid period format for span' }, { status: 400 });
    }
    const [, periodEnd] = range;
    // periodEnd is exclusive (first day of next period) — subtract 1 day to get the last day
    const periodEndInclusive = new Date(new Date(periodEnd + 'T00:00:00').getTime() - 86400000)
      .toISOString().slice(0, 10);

    // --- channelMetrics ---
    const channelMetricsResult = await pool.query(`
      SELECT
        CASE
          WHEN '微信支付' = ANY(payment_methods) THEN 'WECHAT'
          WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
          WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
          WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
          ELSE 'OTHER'
        END AS channel,
        COALESCE(SUM(net_amt), 0) AS qimai_net_amt
      FROM gelatomiiix_ods.income_detail
      WHERE NOT is_refund
        AND NOT is_member_payment
        AND biz_date <= $1::DATE
      GROUP BY channel
      ORDER BY channel
    `, [periodEndInclusive]);

    // --- bank entry by channel ---
    const bankEntryResult = await pool.query(`
      SELECT
        r.lvl2_code AS channel,
        COALESCE(SUM(t.amount), 0) AS bank_entry_amt
      FROM brand_gelatomiiix_ods.v_bank_txn t
      JOIN brand_gelatomiiix_cfg.bank_rule_map r
        ON t.counterparty_name ILIKE '%' || r.match_value || '%'
      WHERE r.direction = 'in'
        AND r.lvl1_code = 'REV_BIZ'
        AND t.txn_date <= $1::DATE
      GROUP BY r.lvl2_code
    `, [periodEndInclusive]);

    // --- monthlyTrend ---
    const monthlyTrendResult = await pool.query(`
      WITH qimai_monthly AS (
        SELECT to_char(biz_date, 'YYYY-MM') AS month, SUM(net_amt) AS qimai_net_amt
        FROM gelatomiiix_ods.income_detail
        WHERE NOT is_refund AND NOT is_member_payment
        GROUP BY 1
      ),
      bank_monthly AS (
        SELECT to_char(txn_date, 'YYYY-MM') AS month, SUM(t.amount) AS bank_entry_amt
        FROM brand_gelatomiiix_ods.v_bank_txn t
        JOIN brand_gelatomiiix_cfg.bank_rule_map r
          ON t.counterparty_name ILIKE '%' || r.match_value || '%'
        WHERE r.direction = 'in' AND r.lvl1_code = 'REV_BIZ'
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
        CASE
          WHEN '微信支付' = ANY(payment_methods) THEN 'WECHAT'
          WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
          WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
          WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
          ELSE 'OTHER'
        END AS channel,
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS unentered_amt
      FROM gelatomiiix_ods.income_detail
      WHERE third_party_txn_no IS NULL
        AND NOT is_refund
        AND NOT is_member_payment
        AND biz_date <= $1::DATE
      GROUP BY channel
      ORDER BY channel
    `, [periodEndInclusive]);

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

    for (const channel of allChannels) {
      const qimaiAmt = qimaiByChannel.get(channel) || 0;
      const bankAmt = bankByChannel.get(channel) || 0;
      totalQimai += qimaiAmt;
      totalBank += bankAmt;
      channelMetrics.push({
        channel,
        qimai_net_amt: qimaiAmt.toFixed(2),
        bank_entry_amt: bankAmt.toFixed(2),
        entry_rate: qimaiAmt > 0 ? (bankAmt / qimaiAmt * 100).toFixed(2) : '0.00',
      });
    }

    channelMetrics.push({
      channel: 'TOTAL',
      qimai_net_amt: totalQimai.toFixed(2),
      bank_entry_amt: totalBank.toFixed(2),
      entry_rate: totalQimai > 0 ? (totalBank / totalQimai * 100).toFixed(2) : '0.00',
    });

    const monthlyTrend = (monthlyTrendResult.rows as { month: string; qimai_net_amt: string; bank_entry_amt: string }[])
      .map(r => ({
        month: r.month,
        qimai_net_amt: parseFloat(r.qimai_net_amt).toFixed(2),
        bank_entry_amt: parseFloat(r.bank_entry_amt).toFixed(2),
      }));

    const unmatchedOrders = (unmatchedOrdersResult.rows as { channel: string; order_count: string; unentered_amt: string }[])
      .map(r => ({
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