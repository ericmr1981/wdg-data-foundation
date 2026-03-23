import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// GET /api/coverage/unclassified-by-file - 获取按文件维度的未分类TopN
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = searchParams.get('brand') || 'yufeng';
  const fileId = searchParams.get('file_id');

  try {
    let query = '';
    let queryParams: (string | number)[] = [];

    if (brand === 'yufeng') {
      if (fileId) {
        query = `
          SELECT source_file_id, file_name, month, counterparty_name, summary, memo,
                 combined_text, txn_rows, in_amt, out_amt, total_amt
          FROM yufeng_dm.v_unclassified_top_by_file
          WHERE source_file_id = $1
          ORDER BY txn_rows DESC, total_amt DESC
          LIMIT 20
        `;
        queryParams = [parseInt(fileId)];
      } else {
        query = `
          SELECT source_file_id, file_name, month, counterparty_name, summary, memo,
                 combined_text, txn_rows, in_amt, out_amt, total_amt
          FROM yufeng_dm.v_unclassified_top_by_file
          ORDER BY source_file_id DESC, txn_rows DESC, total_amt DESC
          LIMIT 50
        `;
      }
    } else if (brand === 'bonjur') {
      return NextResponse.json({ success: true, data: [] });
    } else {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const result = await pool.query(query, queryParams);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching unclassified by file:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch unclassified by file' }, { status: 500 });
  }
}
