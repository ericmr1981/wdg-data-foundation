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

    // Get order amount distribution (20-yuan buckets) from all orders in the month
    const result = await pool.query(`
      WITH bins AS (
        SELECT
          floor(COALESCE(gross_amt, 0) / 20) * 20 AS bin_start,
          COUNT(*) AS order_cnt
        FROM gelatomiiix_ods.income_detail
        WHERE store_code = $1
          AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
          AND NOT is_refund
        GROUP BY floor(COALESCE(gross_amt, 0) / 20) * 20
      )
      SELECT
        bin_start,
        (bin_start + 19) AS bin_end,
        order_cnt
      FROM bins
      ORDER BY bin_start
    `, [storeCode, `${month}-01`]);

    const data = result.rows.map((r: any) => ({
      range: `¥${Number(r.bin_start)}-${Number(r.bin_start) + 20}`,
      count: Number(r.order_cnt),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const pgError = error as Record<string, string>;
    if (pgError?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
