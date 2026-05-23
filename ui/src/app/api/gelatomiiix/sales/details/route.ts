import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');
    const type = searchParams.get('type') || 'cash_register';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    if (type === 'product') {
      const countResult = await pool.query(`
        SELECT COUNT(*) AS total
        FROM gelatomiiix_ods.product_sales_detail
        WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      `, [storeCode, `${month}-01`]);

      const dataResult = await pool.query(`
        SELECT biz_date, order_no, product_name, unit_price, qty, sales_amt, received_amt, discount_amt
        FROM gelatomiiix_ods.product_sales_detail
        WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        ORDER BY biz_date, order_no
        LIMIT $3 OFFSET $4
      `, [storeCode, `${month}-01`, limit, offset]);

      return NextResponse.json({
        success: true,
        data: dataResult.rows,
        total: parseInt(countResult.rows[0].total, 10),
        page, limit,
      });
    }

    const countResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM gelatomiiix_ods.cash_register_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
    `, [storeCode, `${month}-01`]);

    const dataResult = await pool.query(`
      SELECT biz_date, order_no, gross_amt, revenue_amt, discount_amt, net_amt, txn_qty, payment_method
      FROM gelatomiiix_ods.cash_register_detail
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      ORDER BY biz_date DESC, order_no
      LIMIT $3 OFFSET $4
    `, [storeCode, `${month}-01`, limit, offset]);

    return NextResponse.json({
      success: true,
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page, limit,
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
