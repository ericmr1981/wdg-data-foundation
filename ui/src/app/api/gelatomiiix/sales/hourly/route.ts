import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
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

    const pureFilter = pureMode
      ? `AND order_no NOT IN (SELECT order_no_clean FROM gelatomiiix_ods.income_detail WHERE '自定义结账方式' = ANY(payment_methods) AND store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE)`
      : '';

    const result = await pool.query(`
      SELECT order_hour, COUNT(DISTINCT order_no) AS order_cnt
      FROM gelatomiiix_ods.product_sales_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND order_hour IS NOT NULL
        ${pureFilter}
      GROUP BY order_hour
      ORDER BY order_hour
    `, [storeCode, `${month}-01`]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
