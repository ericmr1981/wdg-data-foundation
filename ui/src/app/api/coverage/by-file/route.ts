import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/coverage/by-file?brand=xxx - 获取按文件维度的覆盖率统计
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const schema = getDmSchema(brand);

    try {
      const query = `
        SELECT source_file_id, file_name, file_path, store_code, file_month,
               total_rows, covered_rows, unclassified_rows, coverage_rate_rows,
               total_in_amt, covered_in_amt, unclassified_in_amt, coverage_rate_in_amt,
               total_out_amt, covered_out_amt, unclassified_out_amt, coverage_rate_out_amt,
               uploaded_at, import_status
        FROM ${schema}.v_coverage_by_file
        ORDER BY uploaded_at DESC
        LIMIT 20
      `;

      const result = await pool.query(query);

      return NextResponse.json({ success: true, data: result.rows });
    } catch (error: any) {
      // 如果视图尚未创建（T8.5 进行中），先优雅降级为“暂无数据”
      // Postgres: 42P01 = undefined_table
      const pgCode = error?.code;
      if (pgCode === '42P01') {
        return NextResponse.json({ success: true, data: [], note: 'v_coverage_by_file not ready' });
      }

      console.error('Error fetching coverage by file:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch coverage by file' }, { status: 500 });
    }
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
