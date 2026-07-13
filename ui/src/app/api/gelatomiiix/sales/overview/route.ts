import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSalesOverview } from '@/lib/repositories/sales-repository';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');
    const pureMode = searchParams.get('pure_mode') === 'true';

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const opts = pureMode ? { pureMode: true } : undefined;
    const excludeCustom = pureMode ? `AND payment_methods IS NOT NULL AND NOT ('自定义结账方式' = ANY(payment_methods))` : '';

    const kpiPromise = getSalesOverview('gelatomiiix', storeCode, month, opts);

    const dailyPromise = pool.query(`
      SELECT
        biz_date,
        SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
        SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM gelatomiiix_ods.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND NOT is_refund
        ${excludeCustom}
      GROUP BY biz_date
      ORDER BY biz_date
    `, [storeCode, `${month}-01`]);

    const prevPromise = pool.query(`
      SELECT
        COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_sales_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM gelatomiiix_ods.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = ($2::DATE - INTERVAL '1 month')::DATE
        AND NOT is_refund
        ${excludeCustom}
    `, [storeCode, `${month}-01`]);

    const [kpi, dailyRes, prevRes] = await Promise.all([kpiPromise, dailyPromise, prevPromise]);

    return NextResponse.json({
      success: true,
      data: {
        kpi,
        daily: dailyRes.rows,
        prev_month: prevRes.rows[0],
      },
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
