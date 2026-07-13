import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema } from '@/lib/brand-server';
import { getErrorMessage, getErrorCode } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';

export const dynamic = 'force-dynamic';

const UNSUPPORTED_BRANDS = ['tamkoko', 'yufeng'];
const NOT_DEPLOYED_BRANDS = ['xintiandi'];

// GET /api/income/unmatched-orders?brand=gelatomiiix&period=2026-04&span=month&store=sh_xtd&channel=WECHAT
// Returns unmatched orders from income_detail where third_party_txn_no IS NULL,
// grouped by month and channel, with count and total amount.
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const brandParam = sp.get('brand');
    const period = sp.get('period') || 'all';
    const span = sp.get('span') || 'month';
    const store = sp.get('store') || '';

    if (!brandParam) {
      return NextResponse.json({ success: false, error: 'brand required' }, { status: 400 });
    }

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'invalid_brand' }, { status: 400 });
    }

    if (UNSUPPORTED_BRANDS.includes(brand) || NOT_DEPLOYED_BRANDS.includes(brand)) {
      return NextResponse.json({
        success: false,
        error: 'unmatched orders not supported for this brand',
      }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const incomeOds = brand === 'gelatomiiix' ? 'gelatomiiix_ods' : odsSchema;

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      [periodStart, periodEnd] = range;
    }

    const params: (string | number)[] = [];
    const clauses: string[] = [];

    if (store && store !== 'all') {
      params.push(store);
      clauses.push(`AND store_code = $${params.length}`);
    }
    if (periodStart && periodEnd) {
      params.push(periodStart);
      clauses.push(`AND biz_date >= $${params.length}::DATE`);
      params.push(periodEnd);
      clauses.push(`AND biz_date < $${params.length}::DATE`);
    }

    const sql = `
      SELECT
        to_char(biz_date, 'YYYY-MM') AS month,
        COUNT(*) AS order_count,
        COALESCE(SUM(net_amt), 0) AS unentered_amt
      FROM ${incomeOds}.income_detail
      WHERE third_party_txn_no IS NULL
        AND NOT is_refund
        AND NOT is_member_payment
        ${clauses.join('\n      ')}
      GROUP BY 1
      ORDER BY 1 DESC
    `;

    const result = await pool.query(sql, params);

    const rows = (result.rows as { month: string; order_count: string; unentered_amt: string }[])
      .map(r => ({
        month: r.month,
        order_count: parseInt(r.order_count) || 0,
        unentered_amt: parseFloat(r.unentered_amt) || 0,
      }));

    return NextResponse.json({
      success: true,
      data: {
        brand,
        period,
        span,
        store: store || 'all',
        rows,
      },
    });
  } catch (error: unknown) {
    if (getErrorCode(error) === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}