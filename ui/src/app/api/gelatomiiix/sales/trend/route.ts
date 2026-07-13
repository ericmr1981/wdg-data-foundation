import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getOdsSchema } from '@/lib/brand-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const BRAND = 'gelatomiiix';
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const pureMode = searchParams.get('pure_mode') === 'true';

    if (!storeCode) {
      return NextResponse.json({ success: false, error: 'store_code required' }, { status: 400 });
    }

    const pureFilter = pureMode ? `AND payment_methods IS NOT NULL AND NOT ('自定义结账方式' = ANY(payment_methods))` : '';

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('month', biz_date)::DATE AS month,
        SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
        SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM ${getOdsSchema(BRAND)}.income_detail
      WHERE store_code = $1
        AND NOT is_refund
        ${pureFilter}
        AND biz_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
      GROUP BY DATE_TRUNC('month', biz_date)::DATE
      ORDER BY month
    `, [storeCode]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
