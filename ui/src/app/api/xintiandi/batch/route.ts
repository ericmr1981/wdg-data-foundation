import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth-server';

// GET /api/xintiandi/batch - 获取导入批次列表
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await pool.query(`
      SELECT 
        batch_id,
        file_name,
        file_size,
        total_rows,
        success_rows,
        error_rows,
        status,
        error_message,
        created_at,
        finished_at
      FROM xintiandi.import_batch
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return NextResponse.json({ success: true, data: result.rows });

  } catch (error: any) {
    console.error('Error fetching xintiandi batches:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
