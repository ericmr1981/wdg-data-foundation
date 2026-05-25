import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

interface ChannelRow {
  payment_method: string;
  gross_amt: string;
  revenue_amt: string;
  txn_cnt: string;
}

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

    const excludeCustom = pureMode ? `AND pm != '自定义结账方式'` : '';

    const result = await pool.query(`
      SELECT
        pm AS payment_method,
        COUNT(*) AS txn_cnt,
        SUM(COALESCE(gross_amt,0)) AS gross_amt,
        SUM(COALESCE(revenue_amt,0)) AS revenue_amt
      FROM gelatomiiix_ods.income_detail,
      LATERAL unnest(payment_methods) AS pm
      WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND NOT is_refund
        ${excludeCustom}
      GROUP BY pm
      ORDER BY gross_amt DESC
    `, [storeCode, `${month}-01`]);

    const total = result.rows.reduce((acc: number, r: ChannelRow) => acc + Number(r.gross_amt), 0);
    const data = result.rows.map((r: ChannelRow) => ({
      ...r,
      gross_amt: Number(r.gross_amt),
      revenue_amt: Number(r.revenue_amt),
      txn_cnt: Number(r.txn_cnt),
      pct: total > 0 ? Math.round(Number(r.gross_amt) / total * 10000) / 100 : 0,
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
