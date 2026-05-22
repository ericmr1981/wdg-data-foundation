import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// GET /api/rules/files - 获取最近成功的 bank 文件列表
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!brand) {
      return NextResponse.json(
        { success: false, error: 'Missing brand' },
        { status: 400 }
      );
    }

    const result = await pool.query(`
      SELECT id, file_name, store_code, month, status
      FROM raw.ingest_file
      WHERE brand_code = $1 AND source_type = 'bank' AND status = 'success'
      ORDER BY created_at DESC
      LIMIT $2
    `, [brand, limit]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching files:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch files' },
      { status: 500 }
    );
  }
}
