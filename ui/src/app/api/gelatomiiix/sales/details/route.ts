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
    const month = searchParams.get('month');
    const type = searchParams.get('type') || 'cash_register';
    const pureMode = searchParams.get('pure_mode') === 'true';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const safePage = Math.max(page, 1);
    const offset = (safePage - 1) * safeLimit;

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const excludeCustom = pureMode ? `AND payment_methods IS NOT NULL AND NOT ('自定义结账方式' = ANY(payment_methods))` : '';

    if (type === 'product') {
      const countResult = await pool.query(`
        SELECT COUNT(*) AS total
        FROM ${getOdsSchema(BRAND)}.product_sales_detail
        WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      `, [storeCode, `${month}-01`]);

      const dataResult = await pool.query(`
        SELECT biz_date, order_no, product_name, unit_price, qty, sales_amt, received_amt, discount_amt
        FROM ${getOdsSchema(BRAND)}.product_sales_detail
        WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        ORDER BY biz_date, order_no
        LIMIT $3 OFFSET $4
      `, [storeCode, `${month}-01`, safeLimit, offset]);

      return NextResponse.json({
        success: true,
        data: dataResult.rows,
        total: parseInt(countResult.rows[0].total, 10),
        page: safePage, limit: safeLimit,
      });
    }

    const countResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM ${getOdsSchema(BRAND)}.income_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND NOT is_refund
        ${excludeCustom}
    `, [storeCode, `${month}-01`]);

    const dataResult = await pool.query(`
      SELECT biz_date, order_no, gross_amt, revenue_amt, discount_amt, net_amt, payment_methods
      FROM ${getOdsSchema(BRAND)}.income_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND NOT is_refund
        ${excludeCustom}
      ORDER BY biz_date DESC, order_no
      LIMIT $3 OFFSET $4
    `, [storeCode, `${month}-01`, safeLimit, offset]);

    return NextResponse.json({
      success: true,
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page: safePage, limit: safeLimit,
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
