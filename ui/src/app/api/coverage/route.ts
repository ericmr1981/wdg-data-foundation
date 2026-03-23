import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';

// GET /api/coverage?brand=xxx - 获取覆盖率统计
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brandParam = searchParams.get('brand') || 'yufeng';
  const brand = normalizeBrand(brandParam);

  if (!brand) {
    return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
  }

  const schema = getDmSchema(brand);

  try {
    const result = await pool.query(`
      SELECT month, total_rows, covered_rows, unclassified_rows, coverage_rate_rows,
             total_in_amt, covered_in_amt, unclassified_in_amt, coverage_rate_in_amt,
             total_out_amt, covered_out_amt, unclassified_out_amt, coverage_rate_out_amt
      FROM ${schema}.v_coverage_monthly
      ORDER BY month DESC
      LIMIT 3
    `);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: any) {
    const pgCode = error?.code;
    if (pgCode === '42P01') {
      return NextResponse.json({ success: true, data: [], note: 'v_coverage_monthly not ready' });
    }

    console.error('Error fetching coverage:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch coverage' }, { status: 500 });
  }
}
