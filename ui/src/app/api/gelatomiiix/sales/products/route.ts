import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSalesByProduct } from '@/lib/repositories/sales-repository';
import { getErrorMessage } from '@/lib/query-types';
import { getOdsSchema } from '@/lib/brand-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const BRAND = 'gelatomiiix';
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');
    const pureMode = searchParams.get('pure_mode') === 'true';

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const opts = pureMode ? { pureMode: true } : undefined;
    const bySales = await getSalesByProduct('gelatomiiix', storeCode, month, opts);

    const pureFilterSql = pureMode
      ? `AND order_no NOT IN (
          SELECT order_no_clean FROM ${getOdsSchema(BRAND)}.income_detail
          WHERE (payment_methods IS NULL OR '自定义结账方式' = ANY(payment_methods))
            AND store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
            AND order_no_clean IS NOT NULL
        )`
      : '';

    const byQty = await pool.query(`
      SELECT product_name,
        SUM(COALESCE(qty,0)) AS total_qty,
        SUM(COALESCE(received_amt,0)) AS total_received_amt
      FROM ${getOdsSchema(BRAND)}.product_sales_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        ${pureFilterSql}
      GROUP BY product_name
      ORDER BY total_qty DESC
      LIMIT 10
    `, [storeCode, `${month}-01`]);

    return NextResponse.json({
      success: true,
      data: { by_sales: bySales, by_qty: byQty.rows },
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
