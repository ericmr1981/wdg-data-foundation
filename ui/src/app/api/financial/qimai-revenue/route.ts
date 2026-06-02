import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand } from '@/lib/brand-server';
import { parsePeriod } from '../period-utils';

// GET /api/financial/qimai-revenue?brand=gelatomiiix&period=2026-06&span=month&store=xxx
// Returns cumulative bank revenue and qimai revenue up to the selected period
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || '';
    const period = searchParams.get('period') || '';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';
    const brand = normalizeBrand(brandParam);
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const boundaries = parsePeriod(period, span);
    if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
    const [, endDate] = boundaries;

    const dmSchema = ['bonjur', 'yufeng'].includes(brand) ? `${brand}_dm` : `brand_${brand}_dm`;
    const odsSchema = `${brand}_ods`;

    // Cumulative bank revenue up to endDate
    const storeClause = store !== 'all' ? 'AND store_code = $2' : '';
    const storeParams = store !== 'all' ? [endDate, store] : [endDate];

    let bankRevenue = 0;
    try {
      const brRes = await pool.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric as bank_revenue
         FROM ${dmSchema}.v_profit_statement
         WHERE section = 'revenue' AND lvl1_code = 'REV_BIZ'
           AND month < $1::date ${storeClause}`,
        storeParams
      );
      bankRevenue = Number(brRes.rows[0]?.bank_revenue || 0);
    } catch {
      // view not ready
    }

    // Cumulative qimai revenue up to endDate
    let qimaiRevenue: number | null = null;
    try {
      const qiRes = await pool.query(
        `SELECT COALESCE(SUM(revenue_amt), 0)::numeric as qimai_revenue
         FROM ${odsSchema}.income_detail
         WHERE biz_date < $1::date ${storeClause}`,
        storeParams
      );
      qimaiRevenue = Number(qiRes.rows[0]?.qimai_revenue || 0);
    } catch {
      // income_detail table doesn't exist for this brand
    }

    return NextResponse.json({
      success: true,
      data: {
        bank_revenue: bankRevenue,
        qimai_revenue: qimaiRevenue,
      },
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
