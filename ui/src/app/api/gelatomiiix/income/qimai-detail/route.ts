import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getOdsSchema } from '@/lib/brand-server';

export const dynamic = 'force-dynamic';

const CHANNEL_MAP: Record<string, string> = {
  '微信支付': 'WECHAT',
  '支付宝支付': 'ALIPAY',
  '美团团购券': 'MEITUAN',
  '云闪付': 'UNIONPAY',
  '抖音团购券': 'DOUYIN',
  '饿了么': 'ELEME',
  '京东支付': 'JD',
};

// GET /api/gelatomiiix/income/qimai-detail?month=2026-04&channel=WECHAT&store=sh_xtd&summary_only=true
export async function GET(request: NextRequest) {
  try {
    const BRAND = 'gelatomiiix';
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const channelFilter = searchParams.get('channel');
    const store = searchParams.get('store');
    const summaryOnly = searchParams.get('summary_only') === 'true';
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = !isNaN(rawPage) ? Math.max(1, rawPage) : 1;
    const rawPageSize = parseInt(searchParams.get('page_size') || '100', 10);
    const pageSize = !isNaN(rawPageSize) ? Math.min(200, Math.max(1, rawPageSize)) : 100;

    if (!month && !dateFrom && !dateTo) {
      return NextResponse.json(
        { success: false, error: 'Provide month or date_from/date_to' },
        { status: 400 }
      );
    }

    // Validate month format
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month must be in YYYY-MM format' },
        { status: 400 }
      );
    }

    // Build WHERE clauses
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (month) {
      conditions.push(`biz_date >= $${paramIdx}::DATE AND biz_date < ($${paramIdx}::DATE + INTERVAL '1 month')`);
      params.push(`${month}-01`);
      paramIdx++;
    } else {
      if (dateFrom) {
        conditions.push(`biz_date >= $${paramIdx}::DATE`);
        params.push(dateFrom);
        paramIdx++;
      }
      if (dateTo) {
        conditions.push(`biz_date <= $${paramIdx}::DATE`);
        params.push(dateTo);
        paramIdx++;
      }
    }

    if (store) {
      conditions.push(`store_code = $${paramIdx}`);
      params.push(store);
      paramIdx++;
    }

    if (channelFilter) {
      const reverseMap = Object.fromEntries(
        Object.entries(CHANNEL_MAP).map(([k, v]) => [v, k])
      );
      const chineseChannel = reverseMap[channelFilter];
      if (chineseChannel) {
        conditions.push(`$${paramIdx} = ANY(payment_methods)`);
        params.push(chineseChannel);
        paramIdx++;
      } else if (channelFilter === 'OTHER') {
        const knownMethods = Object.keys(CHANNEL_MAP);
        conditions.push(
          `NOT (payment_methods && ARRAY[${knownMethods.map((_, i) => `$${paramIdx + i}`).join(',')}])`
        );
        params.push(...knownMethods);
        paramIdx += knownMethods.length;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    if (summaryOnly) {
      const summaryRes = await pool.query(`
        SELECT
          COUNT(*) AS order_count,
          COALESCE(SUM(net_amt), 0) AS total_net_amt,
          COALESCE(SUM(revenue_amt), 0) AS total_revenue_amt,
          COALESCE(SUM(gross_amt), 0) AS total_gross_amt,
          COALESCE(SUM(CASE WHEN is_refund THEN 1 ELSE 0 END), 0) AS refund_count
        FROM ${getOdsSchema(BRAND)}.income_detail
        ${whereClause}
      `, params);

      const byChannelRes = await pool.query(`
        SELECT
          CASE
            WHEN '微信支付' = ANY(payment_methods) THEN 'WECHAT'
            WHEN '支付宝支付' = ANY(payment_methods) THEN 'ALIPAY'
            WHEN '美团团购券' = ANY(payment_methods) THEN 'MEITUAN'
            WHEN '云闪付' = ANY(payment_methods) THEN 'UNIONPAY'
            WHEN '抖音团购券' = ANY(payment_methods) THEN 'DOUYIN'
            WHEN '饿了么' = ANY(payment_methods) THEN 'ELEME'
            WHEN '京东支付' = ANY(payment_methods) THEN 'JD'
            ELSE 'OTHER'
          END AS channel,
          COUNT(*) AS order_count,
          COALESCE(SUM(net_amt), 0) AS net_amt
        FROM ${getOdsSchema(BRAND)}.income_detail
        ${whereClause}
        GROUP BY channel
        ORDER BY SUM(net_amt) DESC NULLS LAST
      `, params);

      const byChannel = byChannelRes.rows.map((r: { channel: string; order_count: string; net_amt: string }) => ({
        channel: r.channel,
        order_count: parseInt(r.order_count),
        net_amt: parseFloat(r.net_amt),
      }));

      const s = summaryRes.rows[0];
      return NextResponse.json({
        success: true,
        data: {
          summary: {
            total_net_amt: parseFloat(s.total_net_amt),
            total_revenue_amt: parseFloat(s.total_revenue_amt),
            total_gross_amt: parseFloat(s.total_gross_amt),
            order_count: parseInt(s.order_count),
            refund_count: parseInt(s.refund_count),
          },
          by_channel: byChannel,
        },
      });
    }

    // Detail mode with pagination
    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM ${getOdsSchema(BRAND)}.income_detail ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].total, 10);

    const offset = (page - 1) * pageSize;
    params.push(offset, pageSize);
    const detailRes = await pool.query(`
      SELECT biz_date, order_no, order_no_clean,
             net_amt, revenue_amt,
             payment_methods, third_party_txn_no,
             biz_source, is_member_payment,
             store_code
      FROM ${getOdsSchema(BRAND)}.income_detail
      ${whereClause}
      ORDER BY biz_date DESC, pay_time DESC
      OFFSET $${paramIdx} LIMIT $${paramIdx + 1}
    `, params);

    const items = detailRes.rows.map((r: {
      biz_date: Date; order_no: string; net_amt: string; revenue_amt: string;
      payment_methods: string[] | null; third_party_txn_no: string | null;
      biz_source: string | null; is_member_payment: boolean; store_code: string;
    }) => ({
      biz_date: r.biz_date,
      order_no: r.order_no,
      channel: r.payment_methods?.[0] ? (CHANNEL_MAP[r.payment_methods[0]] || 'OTHER') : null,
      net_amt: parseFloat(r.net_amt),
      revenue_amt: parseFloat(r.revenue_amt),
      third_party_txn_no: r.third_party_txn_no,
      biz_source: r.biz_source,
      payment_methods: r.payment_methods,
      is_member_payment: r.is_member_payment,
    }));

    return NextResponse.json({
      success: true,
      data: { items, total, page, pageSize },
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
