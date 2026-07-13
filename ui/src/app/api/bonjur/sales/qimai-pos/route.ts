import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage, getErrorCode } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

// GET /api/bonjur/sales/qimai-pos?month=2026-04&store=wz_oh_wxc&summary_only=true
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const store = searchParams.get('store');
    const summaryOnly = searchParams.get('summary_only') === 'true';

    if (!month && !dateFrom && !dateTo) {
      return NextResponse.json(
        { success: false, error: 'Provide month or date_from/date_to' },
        { status: 400 }
      );
    }

    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month must be in YYYY-MM format' },
        { status: 400 }
      );
    }

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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    if (summaryOnly) {
      const res = await pool.query(`
        SELECT
          COALESCE(SUM(wechat_pay_pos_gross_amt), 0) AS total_wechat_pos_gross,
          COALESCE(SUM(wechat_pay_pos_revenue_amt), 0) AS total_wechat_pos_revenue,
          COALESCE(SUM(alipay_pay_pos_gross_amt), 0) AS total_alipay_pos_gross,
          COALESCE(SUM(alipay_pay_pos_revenue_amt), 0) AS total_alipay_pos_revenue
        FROM bonjur_ods.sales_daily_self_service
        ${whereClause}
      `, params);

      const r = res.rows[0];
      return NextResponse.json({
        success: true,
        data: {
          summary: {
            total_wechat_pos_gross: parseFloat(r.total_wechat_pos_gross),
            total_wechat_pos_revenue: parseFloat(r.total_wechat_pos_revenue),
            total_alipay_pos_gross: parseFloat(r.total_alipay_pos_gross),
            total_alipay_pos_revenue: parseFloat(r.total_alipay_pos_revenue),
          },
        },
      });
    }

    const detailRes = await pool.query(`
      SELECT biz_date,
             wechat_pay_pos_gross_amt, wechat_pay_pos_revenue_amt,
             alipay_pay_pos_gross_amt, alipay_pay_pos_revenue_amt
      FROM bonjur_ods.sales_daily_self_service
      ${whereClause}
      ORDER BY biz_date DESC
    `, params);

    const items = detailRes.rows.map((r: {
      biz_date: Date; wechat_pay_pos_gross_amt: string; wechat_pay_pos_revenue_amt: string;
      alipay_pay_pos_gross_amt: string; alipay_pay_pos_revenue_amt: string;
    }) => ({
      biz_date: r.biz_date,
      wechat_pos_gross_amt: parseFloat(r.wechat_pay_pos_gross_amt),
      wechat_pos_revenue_amt: parseFloat(r.wechat_pay_pos_revenue_amt),
      alipay_pos_gross_amt: parseFloat(r.alipay_pay_pos_gross_amt),
      alipay_pos_revenue_amt: parseFloat(r.alipay_pay_pos_revenue_amt),
    }));

    return NextResponse.json({ success: true, data: { items } });
  } catch (error: unknown) {
    if (getErrorCode(error) === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
