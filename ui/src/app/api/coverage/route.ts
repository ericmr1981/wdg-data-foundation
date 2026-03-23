import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// GET /api/coverage - 获取覆盖率统计
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT month, total_rows, covered_rows, unclassified_rows, coverage_rate_rows,
             total_in_amt, covered_in_amt, unclassified_in_amt, coverage_rate_in_amt,
             total_out_amt, covered_out_amt, unclassified_out_amt, coverage_rate_out_amt
      FROM yufeng_dm.v_coverage_monthly
      ORDER BY month DESC
      LIMIT 3
    `);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching coverage:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch coverage' }, { status: 500 });
  }
}
