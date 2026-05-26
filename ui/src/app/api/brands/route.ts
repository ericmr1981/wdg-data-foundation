import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/brands - list enabled brands for selector
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

  try {
    const res = await pool.query(
      `SELECT brand_code, brand_name
       FROM ops.brands
       WHERE enabled=true
       ORDER BY sort_order NULLS LAST, brand_code`
    );
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
