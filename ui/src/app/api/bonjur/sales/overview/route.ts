import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSalesOverview } from '@/lib/repositories/sales-repository';
import { getErrorMessage } from '@/lib/query-types';
import { getOdsSchema } from '@/lib/brand-server';

const BRAND = 'bonjur';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const kpiPromise = getSalesOverview('bonjur', storeCode, month);

    const dailyPromise = pool.query(`
      SELECT
        biz_date,
        SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
        SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM ${getOdsSchema(BRAND)}.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      GROUP BY biz_date
      ORDER BY biz_date
    `, [storeCode, `${month}-01`]);

    const prevPromise = pool.query(`
      SELECT
        COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_sales_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM ${getOdsSchema(BRAND)}.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = ($2::DATE - INTERVAL '1 month')::DATE
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
  } catch (error) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
