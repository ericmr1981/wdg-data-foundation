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

    const params = [storeCode, `${month}-01`];
    const pureFilterSql = pureMode
      ? ` AND order_no NOT IN (
          SELECT order_no_clean FROM gelatomiiix_ods.income_detail
          WHERE (payment_methods IS NULL OR '自定义结账方式' = ANY(payment_methods))
            AND store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
            AND order_no_clean IS NOT NULL
        )`
      : '';

    const bySales = await pool.query(`
      SELECT product_name,
        SUM(COALESCE(qty,0)) AS total_qty,
        SUM(COALESCE(received_amt,0)) AS total_received_amt
      FROM gelatomiiix_ods.product_sales_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      ${pureFilterSql}
      GROUP BY product_name
      ORDER BY total_received_amt DESC
      LIMIT 10
    `, params);

    const byQty = await pool.query(`
      SELECT product_name,
        SUM(COALESCE(qty,0)) AS total_qty,
        SUM(COALESCE(received_amt,0)) AS total_received_amt
      FROM gelatomiiix_ods.product_sales_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      ${pureFilterSql}
      GROUP BY product_name
      ORDER BY total_qty DESC
      LIMIT 10
    `, params);

    return NextResponse.json({ success: true, data: { by_sales: bySales.rows, by_qty: byQty.rows } });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
