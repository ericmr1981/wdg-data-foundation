import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');

    if (!storeCode) {
      return NextResponse.json({ success: false, error: 'store_code required' }, { status: 400 });
    }

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('month', biz_date)::DATE AS month,
        SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
        SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM gelatomiiix_ods.cash_register_detail
      WHERE store_code = $1
        AND biz_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
      GROUP BY DATE_TRUNC('month', biz_date)::DATE
      ORDER BY month
    `, [storeCode]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
