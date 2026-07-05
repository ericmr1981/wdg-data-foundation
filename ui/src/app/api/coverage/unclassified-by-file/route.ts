import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/coverage/unclassified-by-file?brand=xxx&file_id=123 - 获取按文件维度的未分类TopN
export async function GET(request: Request) {
  const isMcp = request.headers.get('x-mcp-session') === 'internal';
  if (!isMcp) {
    const user = await getSessionUser();
    try {
      assertRole(user, ['admin', 'operator']);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const brandParam = searchParams.get('brand') || 'yufeng';
  const brand = normalizeBrand(brandParam);
  const fileId = searchParams.get('file_id');

  if (!brand) {
    return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
  }

  const schema = getDmSchema(brand);

  try {
    let query = '';
    let queryParams: (string | number)[] = [];

    if (fileId) {
      query = `
        SELECT source_file_id, file_name, month, counterparty_name, summary, memo,
               combined_text, txn_rows, in_amt, out_amt, total_amt
        FROM ${schema}.v_unclassified_top_by_file
        WHERE source_file_id = $1
        ORDER BY txn_rows DESC, total_amt DESC
        LIMIT 20
      `;
      queryParams = [parseInt(fileId)];
    } else {
      query = `
        SELECT source_file_id, file_name, month, counterparty_name, summary, memo,
               combined_text, txn_rows, in_amt, out_amt, total_amt
        FROM ${schema}.v_unclassified_top_by_file
        ORDER BY source_file_id DESC, txn_rows DESC, total_amt DESC
        LIMIT 50
      `;
    }

    const result = await pool.query(query, queryParams);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: any) {
    // 视图未就绪时，避免页面直接红错
    const pgCode = error?.code;
    if (pgCode === '42P01') {
      return NextResponse.json({ success: true, data: [], note: 'v_unclassified_top_by_file not ready' });
    }

    console.error('Error fetching unclassified by file:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch unclassified by file' }, { status: 500 });
  }
}