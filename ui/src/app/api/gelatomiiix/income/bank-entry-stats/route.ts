import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

interface ChannelMetric {
  channel: string;
  qimai_net_amt: string;
  bank_entry_amt: string;
  entry_rate: string;
}

interface MonthlyTrend {
  month: string;
  qimai_net_amt: string;
  bank_entry_amt: string;
}

interface UnmatchedOrder {
  channel: string;
  order_count: string;
  unentered_amt: string;
}

// GET /api/gelatomiiix/income/bank-entry-stats?brand=gelatomiiix&period=2026-04
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    const period = searchParams.get('period');

    if (!brand || !period) {
      return NextResponse.json({ success: false, error: 'brand and period required' }, { status: 400 });
    }

    // Validate period format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ success: false, error: 'period must be YYYY-MM' }, { status: 400 });
    }

    // period end = last day of the month
    const periodEnd = `${period}-01`;

    // --- channelMetrics ---
    // Qimai net amounts grouped by payment channel up to period end date
    const channelMetricsQuery = `
      SELECT
        CASE
          WHEN $2 = ANY(payment_methods) THEN 'WECHAT'
          WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
          WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
          WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
          ELSE 'OTHER'
        END AS channel,
        COALESCE(SUM(net_amt), 0) AS qimai_net_amt
      FROM gelatomiiix_ods.income_detail
      WHERE NOT is_refund
        AND NOT is_member_payment
        AND biz_date <= ($1 || '-01')::DATE + INTERVAL '1 month - 1 day'
      GROUP BY channel
      ORDER BY channel
    `;

    // Bank entry amounts by channel (lvl2_code) up to period end date
    const bankEntryQuery = `
      SELECT
        r.lvl2_code AS channel,
        COALESCE(SUM(t.amount), 0) AS bank_entry_amt
      FROM brand_gelatomiiix_ods.v_bank_txn t
      JOIN brand_gelatomiiix_cfg.bank_rule_map r
        ON t.counterparty_name ILIKE '%' || r.match_value || '%'
      WHERE r.direction = 'in'
        AND r.lvl1_code = 'REV_BIZ'
        AND t.txn_date <= ($1 || '-01')::DATE + INTERVAL '1 month - 1 day'
      GROUP BY r.lvl2_code
    `;

    // --- monthlyTrend ---
    // Monthly Qimai net vs bank entry (full outer join so months with only one side still show)
    const monthlyTrendQuery = `
      WITH qimai_monthly AS (
        SELECT
          to_char(biz_date, 'YYYY-MM') AS month,
          SUM(net_amt) AS qimai_net_amt
        FROM gelatomiiix_ods.income_detail
        WHERE NOT is_refund
          AND NOT is_member_payment
        GROUP BY to_char(biz_date, 'YYYY-MM')
      ),
      bank_monthly AS (
        SELECT
          to_char(txn_date, 'YYYY-MM') AS month,
          SUM(t.amount) AS bank_entry_amt
        FROM brand_gelatomiiix_ods.v_bank_txn t
        JOIN brand_gelatomiiix_cfg.bank_rule_map r
          ON t.counterparty_name ILIKE '%' || r.match_value || '%'
        WHERE r.direction = 'in'
          AND r.lvl1_code = 'REV_BIZ'
        GROUP BY to_char(txn_date, 'YYYY-MM')
      )
      SELECT
        COALESCE(q.month, b.month) AS month,
        COALESCE(q.qimai_net_amt, 0) AS qimai_net_amt,
        COALESCE(b.bank_entry_amt, 0) AS bank_entry_amt
      FROM qimai_monthly q
      FULL OUTER JOIN bank_monthly b ON q.month = b.month
      ORDER BY month
    `;

    // --- unmatchedOrders ---
    // Qimai orders with no third_party_txn_no (bank entry expected but not yet entered)
    const unmatchedOrdersQuery = `
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
        AND biz_date <= ($1 || '-01')::DATE + INTERVAL '1 month - 1 day'
      GROUP BY channel
      ORDER BY channel
    `;

    const [channelMetricsResult, bankEntryResult, monthlyTrendResult, unmatchedOrdersResult] = await Promise.all([
      pool.query(channelMetricsQuery, [periodEnd]),
      pool.query(bankEntryQuery, [periodEnd]),
      pool.query(monthlyTrendQuery),
      pool.query(unmatchedOrdersQuery, [periodEnd]),
    ]);

    // Build channel metrics by joining Qimai channels with bank entry channels
    const qimaiByChannel = new Map<string, number>();
    for (const row of channelMetricsResult.rows as { channel: string; qimai_net_amt: string }[]) {
      qimaiByChannel.set(row.channel, parseFloat(row.qimai_net_amt));
    }

    const bankByChannel = new Map<string, number>();
    for (const row of bankEntryResult.rows as { channel: string; bank_entry_amt: string }[]) {
      bankByChannel.set(row.channel, parseFloat(row.bank_entry_amt));
    }

    const allChannels = new Set([...qimaiByChannel.keys(), ...bankByChannel.keys()]);
    const channelMetrics: ChannelMetric[] = [];

    let totalQimai = 0;
    let totalBank = 0;

    for (const channel of allChannels) {
      const qimaiAmt = qimaiByChannel.get(channel) || 0;
      const bankAmt = bankByChannel.get(channel) || 0;
      totalQimai += qimaiAmt;
      totalBank += bankAmt;
      const rate = qimaiAmt > 0 ? ((bankAmt / qimaiAmt) * 100).toFixed(2) : '0.00';
      channelMetrics.push({
        channel,
        qimai_net_amt: qimaiAmt.toFixed(2),
        bank_entry_amt: bankAmt.toFixed(2),
        entry_rate: rate,
      });
    }

    // Add TOTAL row
    const totalRate = totalQimai > 0 ? ((totalBank / totalQimai) * 100).toFixed(2) : '0.00';
    channelMetrics.push({
      channel: 'TOTAL',
      qimai_net_amt: totalQimai.toFixed(2),
      bank_entry_amt: totalBank.toFixed(2),
      entry_rate: totalRate,
    });

    // Build monthly trend
    const monthlyTrend: MonthlyTrend[] = (monthlyTrendResult.rows as {
      month: string;
      qimai_net_amt: string;
      bank_entry_amt: string;
    }[]).map(r => ({
      month: r.month,
      qimai_net_amt: parseFloat(r.qimai_net_amt).toFixed(2),
      bank_entry_amt: parseFloat(r.bank_entry_amt).toFixed(2),
    }));

    // Build unmatched orders
    const unmatchedOrders: UnmatchedOrder[] = (unmatchedOrdersResult.rows as {
      channel: string;
      order_count: string;
      unentered_amt: string;
    }[]).map(r => ({
      channel: r.channel,
      order_count: r.order_count,
      unentered_amt: parseFloat(r.unentered_amt).toFixed(2),
    }));

    return NextResponse.json({
      success: true,
      data: {
        channelMetrics,
        monthlyTrend,
        unmatchedOrders,
      },
    });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}