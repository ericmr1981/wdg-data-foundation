import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || '';

    if (!period) {
      return NextResponse.json({ success: false, error: 'period required' }, { status: 400 });
    }

    const range = parsePeriod(period, span);
    if (!range) {
      return NextResponse.json({ success: false, error: 'Invalid period format for span' }, { status: 400 });
    }
    const [, periodEnd] = range;
    const periodEndInclusive = new Date(new Date(periodEnd + 'T00:00:00').getTime() - 86400000)
      .toISOString().slice(0, 10);

    const esc = (s: string) => s.replace(/'/g, "''");
    const dateLit = `'${esc(periodEndInclusive)}'`;
    const storeSnippet = store ? `AND store_code = '${esc(store)}'` : '';
    const bankStoreSnippet = store ? `AND t.store_code = '${esc(store)}'` : '';
    const trendStoreSnippet = store ? `WHERE store_code = '${esc(store)}'` : '';

    // --- channelMetrics ---
    const channelMetricsResult = await pool.query(`SELECT channel, SUM(net_amt) AS qimai_net_amt FROM (
        SELECT
          CASE
            WHEN '微信支付' = ANY(payment_methods) THEN 'WECHAT'
            WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
            WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
            WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
            WHEN '抖音团购券' = ANY(payment_methods) THEN 'DOUYIN'
            ELSE 'OTHER'
          END AS channel,
          net_amt
        FROM bonjur_ods.income_detail
        WHERE biz_date <= ${dateLit}::DATE ${storeSnippet}
      ) sub
      GROUP BY channel
      ORDER BY channel`,
    });

    // --- bank entry by channel ---
    const bankEntryResult = await pool.query({
      text: `SELECT
        r.lvl2_code AS channel,
        COALESCE(SUM(t.in_amt), 0) AS bank_entry_amt
      FROM bonjur_dm.v_bank_txn_classified_v2 t
      JOIN bonjur_cfg.bank_rule_map r
        ON t.counterparty_name ILIKE '%' || r.match_value || '%'
      WHERE r.direction = 'in'
        AND r.lvl1_code = 'REV_BIZ'
        AND t.txn_time::date <= ${dateLit}::DATE ${bankStoreSnippet}
      GROUP BY r.lvl2_code`,
    });

    // --- monthlyTrend ---
    const monthlyTrendQimai = await pool.query({
      text: `SELECT to_char(biz_date, 'YYYY-MM') AS month, SUM(net_amt) AS qimai_net_amt
      FROM bonjur_ods.income_detail
      ${trendStoreSnippet}
      GROUP BY 1 ORDER BY 1`,
    });
    const monthlyTrendBank = await pool.query({
      text: `SELECT to_char(txn_time::date, 'YYYY-MM') AS month, SUM(t.in_amt) AS bank_entry_amt
      FROM bonjur_dm.v_bank_txn_classified_v2 t
      JOIN bonjur_cfg.bank_rule_map r
        ON t.counterparty_name ILIKE '%' || r.match_value || '%'
      WHERE r.direction = 'in' AND r.lvl1_code = 'REV_BIZ'
        ${bankStoreSnippet}
      GROUP BY 1 ORDER BY 1`,
    });

    // Merge monthly trend
    const trendMap = new Map<string, { qimai: number; bank: number }>();
    for (const row of monthlyTrendQimai.rows as { month: string; qimai_net_amt: string }[]) {
      trendMap.set(row.month, { qimai: parseFloat(row.qimai_net_amt), bank: 0 });
    }
    for (const row of monthlyTrendBank.rows as { month: string; bank_entry_amt: string }[]) {
      const existing = trendMap.get(row.month) || { qimai: 0, bank: 0 };
      existing.bank = parseFloat(row.bank_entry_amt);
      trendMap.set(row.month, existing);
    }
    const monthlyTrend = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        qimai_net_amt: v.qimai.toFixed(2),
        bank_entry_amt: v.bank.toFixed(2),
      }));

    // --- unmatchedOrders ---
    const unmatchedOrdersResult = await pool.query({
      text: `SELECT month, channel, COUNT(*) AS order_count, SUM(net_amt) AS unentered_amt FROM (
        SELECT
          to_char(biz_date, 'YYYY-MM') AS month,
          CASE
            WHEN '微信支付' = ANY(payment_methods) THEN 'WECHAT'
            WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
            WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
            WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
            WHEN '抖音团购券' = ANY(payment_methods) THEN 'DOUYIN'
            ELSE 'OTHER'
          END AS channel,
          net_amt
        FROM bonjur_ods.income_detail
        WHERE third_party_txn_no IS NULL
          AND biz_date <= ${dateLit}::DATE ${storeSnippet}
      ) sub
      GROUP BY month, channel
      ORDER BY month DESC, channel`,
    });

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
