import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');
    const paymentMethod = searchParams.get('payment_method');
    const pureMode = searchParams.get('pure_mode') === 'true';

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const excludeCustom = pureMode ? `AND payment_methods IS NOT NULL AND NOT ('自定义结账方式' = ANY(payment_methods))` : '';

    const kpiResult = await pool.query(`
      SELECT
        COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_sales_amt,
        COALESCE(SUM(COALESCE(revenue_amt,0)),0) AS revenue_amt,
        COALESCE(SUM(COALESCE(discount_amt,0)),0) AS discount_amt,
        COALESCE(SUM(COALESCE(net_amt,0)),0) AS net_amt,
        COUNT(DISTINCT order_no) AS order_cnt,
        CASE WHEN COUNT(DISTINCT order_no) > 0
          THEN ROUND(SUM(COALESCE(gross_amt,0)) / COUNT(DISTINCT order_no), 2)
          ELSE NULL
        END AS avg_order_amt
      FROM gelatomiiix_ods.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND ($3::text IS NULL OR $3 = ANY(payment_methods))
        AND NOT is_refund
        ${excludeCustom}
    `, [storeCode, `${month}-01`, paymentMethod || null]);

    const dailyResult = await pool.query(`
      SELECT
        biz_date,
        SUM(COALESCE(gross_amt,0)) AS gross_sales_amt,
        SUM(COALESCE(revenue_amt,0)) AS revenue_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM gelatomiiix_ods.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND ($3::text IS NULL OR $3 = ANY(payment_methods))
        AND NOT is_refund
        ${excludeCustom}
      GROUP BY biz_date
      ORDER BY biz_date
    `, [storeCode, `${month}-01`, paymentMethod || null]);

    const prevMonth = await pool.query(`
      SELECT
        COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_sales_amt,
        COUNT(DISTINCT order_no) AS order_cnt
      FROM gelatomiiix_ods.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = ($2::DATE - INTERVAL '1 month')::DATE
        AND ($3::text IS NULL OR $3 = ANY(payment_methods))
        AND NOT is_refund
        ${excludeCustom}
    `, [storeCode, `${month}-01`, paymentMethod || null]);

    return NextResponse.json({
      success: true,
      data: {
        kpi: kpiResult.rows[0],
        daily: dailyResult.rows,
        prev_month: prevMonth.rows[0],
      },
    });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
