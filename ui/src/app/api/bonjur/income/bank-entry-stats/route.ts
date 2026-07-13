import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { getOdsSchema, getDmSchema, getCfgSchema } from '@/lib/brand-server';

const BRAND = 'bonjur';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || '';

    const hasPeriod = period && period !== 'all';
    let dateClause = '';
    let monthClause = '';
    let unmatchedDateClause = '';
    let trendDateClause = '';
    let trendBankDateClause = '';
    let periodStart = '';
    let periodEnd = '';
    if (hasPeriod) {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'Invalid period format for span' }, { status: 400 });
      }
      [periodStart, periodEnd] = range;
      const periodEndInclusive = new Date(new Date(periodEnd + 'T00:00:00').getTime() - 86400000)
        .toISOString().slice(0, 10);
      const esc = (s: string) => s.replace(/'/g, "''");
      // Channel metrics + bank entry: cumulative up to period end
      dateClause = `AND biz_date < '${esc(periodEnd)}'::DATE`;
      monthClause = `AND s.month < '${esc(periodEnd)}'::DATE`;
      unmatchedDateClause = `AND biz_date >= '${esc(periodStart)}'::DATE AND biz_date <= '${esc(periodEndInclusive)}'::DATE`;
      // Trend: show all data up to period end (cumulative)
      trendDateClause = `AND biz_date < '${esc(periodEnd)}'::DATE`;
      trendBankDateClause = `AND t.txn_time < '${esc(periodEnd)}'::timestamp`;
    }

    const st = store ? store.replace(/'/g, "''") : '';
    const storeWhere = store ? `AND store_code = '${st}'` : '';
    const bankStoreWhere = store ? `AND t.store_code = '${st}'` : '';
    const trendStoreWhere = store ? `WHERE store_code = '${st}'` : '';
    // --- current month channel data ---
    let currMonthDateClause = '1=0';
    let currMonthBankClause = '1=0';
    if (hasPeriod) {
      const esc = (s: string) => s.replace(/'/g, "''");
      currMonthDateClause = `AND biz_date >= '${esc(periodStart)}'::DATE AND biz_date < '${esc(periodEnd)}'::DATE`;
      currMonthBankClause = `AND t.txn_time >= '${esc(periodStart)}'::timestamp AND t.txn_time < '${esc(periodEnd)}'::timestamp`;
    }
    let currBankByChannel = new Map<string, number>();
    let currQimaiByChannel = new Map<string, number>();
    if (hasPeriod) {
      const [currBankRes, currQimaiRes] = await Promise.all([
        pool.query(`SELECT s.lvl2_code AS channel, COALESCE(SUM(t.in_amt),0) AS bank_entry_amt
          FROM ${getDmSchema(BRAND)}.bank_txn_classified_snapshot s
          JOIN ${getOdsSchema(BRAND)}.bank_txn t ON t.id = s.bank_txn_id
          WHERE s.lvl1_code='REV_BIZ' AND s.lvl2_code NOT IN ('OTHER_CH','REFUND_IN') AND s.classified_source IN ('rule','override')
            ${currMonthBankClause} ${bankStoreWhere}
          GROUP BY s.lvl2_code`),
        pool.query(`SELECT
          COALESCE(
            (SELECT m.channel_code FROM ${getCfgSchema(BRAND)}.channel_mapping m WHERE d.payment_methods && ARRAY[m.payment_method] ORDER BY m.sort_order LIMIT 1),
            'OTHER'
          ) AS channel, SUM(net_amt) AS qimai_net_amt
          FROM ${getOdsSchema(BRAND)}.income_detail d
          WHERE 1=1 ${currMonthDateClause} ${storeWhere}
          GROUP BY 1 ORDER BY 1`)
      ]);
      for (const row of currBankRes.rows as { channel: string; bank_entry_amt: string }[]) {
        currBankByChannel.set(row.channel, parseFloat(row.bank_entry_amt));
      }
      for (const row of currQimaiRes.rows as { channel: string; qimai_net_amt: string }[]) {
        currQimaiByChannel.set(row.channel, parseFloat(row.qimai_net_amt));
      }
    }

    const channelMetricsResult = await pool.query(`SELECT
      COALESCE(
        (SELECT m.channel_code FROM ${getCfgSchema(BRAND)}.channel_mapping m WHERE d.payment_methods && ARRAY[m.payment_method] ORDER BY m.sort_order LIMIT 1),
        'OTHER'
      ) AS channel, SUM(net_amt) AS qimai_net_amt
      FROM ${getOdsSchema(BRAND)}.income_detail d
      WHERE 1=1 ${dateClause} ${storeWhere}
      GROUP BY 1 ORDER BY 1`);

    const bankEntryResult = await pool.query(`SELECT s.lvl2_code AS channel, COALESCE(SUM(t.in_amt),0) AS bank_entry_amt
      FROM ${getDmSchema(BRAND)}.bank_txn_classified_snapshot s
      JOIN ${getOdsSchema(BRAND)}.bank_txn t ON t.id = s.bank_txn_id
      WHERE s.lvl1_code='REV_BIZ' AND s.lvl2_code NOT IN ('OTHER_CH','REFUND_IN') AND s.classified_source IN ('rule','override')
        ${monthClause} ${bankStoreWhere}
      GROUP BY s.lvl2_code`);

    const monthlyTrendQimai = await pool.query(
      `SELECT to_char(biz_date,'YYYY-MM') AS month,SUM(net_amt) AS qimai_net_amt
       FROM ${getOdsSchema(BRAND)}.income_detail
       WHERE 1=1 ${trendDateClause} ${storeWhere}
       GROUP BY 1 ORDER BY 1`);
    const monthlyTrendBank = await pool.query(
      `SELECT to_char(t.txn_time::date,'YYYY-MM') AS month,SUM(t.in_amt) AS bank_entry_amt
       FROM ${getDmSchema(BRAND)}.bank_txn_classified_snapshot s
       JOIN ${getOdsSchema(BRAND)}.bank_txn t ON t.id = s.bank_txn_id
       WHERE s.lvl1_code='REV_BIZ' AND s.lvl2_code NOT IN ('OTHER_CH','REFUND_IN') AND s.classified_source IN ('rule','override')
         ${trendBankDateClause} ${bankStoreWhere}
       GROUP BY 1 ORDER BY 1`);

    const trendMap = new Map<string, { q: number; b: number }>();
    for (const r of monthlyTrendQimai.rows as { month: string; qimai_net_amt: string }[]) {
      trendMap.set(r.month, { q: parseFloat(r.qimai_net_amt), b: 0 });
    }
    for (const r of monthlyTrendBank.rows as { month: string; bank_entry_amt: string }[]) {
      const e = trendMap.get(r.month) || { q: 0, b: 0 };
      e.b = parseFloat(r.bank_entry_amt);
      trendMap.set(r.month, e);
    }
    const monthlyTrend = [...trendMap.entries()].sort(([a],[b]) => a.localeCompare(b))
      .map(([m, v]) => ({ month: m, qimai_net_amt: v.q.toFixed(2), bank_entry_amt: v.b.toFixed(2) }));

    const unmatchedOrdersResult = await pool.query(`SELECT month,ch,COUNT(*) oc,SUM(net_amt) ua FROM (
      SELECT to_char(biz_date,'YYYY-MM') AS month,
        COALESCE(
          (SELECT m.channel_code FROM ${getCfgSchema(BRAND)}.channel_mapping m WHERE d.payment_methods && ARRAY[m.payment_method] ORDER BY m.sort_order LIMIT 1),
          'OTHER'
        ) AS ch, net_amt
      FROM ${getOdsSchema(BRAND)}.income_detail d
      WHERE third_party_txn_no IS NULL ${unmatchedDateClause} ${storeWhere}
    ) sub GROUP BY month,ch ORDER BY month DESC,ch`);

    const qimaiByChannel = new Map<string, number>();
    for (const r of channelMetricsResult.rows as { channel: string; qimai_net_amt: string }[]) {
      qimaiByChannel.set(r.channel, parseFloat(r.qimai_net_amt));
    }
    const bankByChannel = new Map<string, number>();
    for (const r of bankEntryResult.rows as { channel: string; bank_entry_amt: string }[]) {
      bankByChannel.set(r.channel, parseFloat(r.bank_entry_amt));
    }
    const allChannels = new Set([...qimaiByChannel.keys(), ...bankByChannel.keys()]);
    const channelMetrics: any[] = [];
    let tq = 0, tb = 0, tcq = 0, tcb = 0;
    for (const ch of allChannels) {
      const qa = qimaiByChannel.get(ch) || 0;
      const ba = bankByChannel.get(ch) || 0;
      const cqa = currQimaiByChannel.get(ch) || 0;
      const cba = currBankByChannel.get(ch) || 0;
      tq += qa; tb += ba; tcq += cqa; tcb += cba;
      channelMetrics.push({ channel: ch, qimai_net_amt: qa.toFixed(2), bank_entry_amt: ba.toFixed(2), entry_rate: qa > 0 ? (ba / qa * 100).toFixed(2) : '0.00', month_qimai_amt: cqa.toFixed(2), month_bank_amt: cba.toFixed(2) });
    }
    channelMetrics.push({ channel: 'TOTAL', qimai_net_amt: tq.toFixed(2), bank_entry_amt: tb.toFixed(2), entry_rate: tq > 0 ? (tb / tq * 100).toFixed(2) : '0.00', month_qimai_amt: tcq.toFixed(2), month_bank_amt: tcb.toFixed(2) });

    const unmatchedOrders = unmatchedOrdersResult.rows.map((r: any) => ({
      month: r.month, channel: r.ch, order_count: r.oc, unentered_amt: parseFloat(r.ua).toFixed(2),
    }));

    return NextResponse.json({ success: true, data: { channelMetrics, monthlyTrend, unmatchedOrders } });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
