import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const bySales = await pool.query(`
      SELECT product_name,
        SUM(COALESCE(qty,0)) AS total_qty,
        SUM(COALESCE(sales_amt,0)) AS total_sales_amt
      FROM gelatomiiix_ods.product_sales_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      GROUP BY product_name
      ORDER BY total_sales_amt DESC
      LIMIT 10
    `, [storeCode, `${month}-01`]);

    const byQty = await pool.query(`
      SELECT product_name,
        SUM(COALESCE(qty,0)) AS total_qty,
        SUM(COALESCE(sales_amt,0)) AS total_sales_amt
      FROM gelatomiiix_ods.product_sales_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      GROUP BY product_name
      ORDER BY total_qty DESC
      LIMIT 10
    `, [storeCode, `${month}-01`]);

    return NextResponse.json({ success: true, data: { by_sales: bySales.rows, by_qty: byQty.rows } });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
