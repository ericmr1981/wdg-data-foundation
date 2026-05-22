import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/stores?brand=yufeng
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brand = String(searchParams.get('brand') || '').trim();
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Missing brand' }, { status: 400 });
    }

    const res = await pool.query(
      `
      SELECT store_code, store_name
      FROM ops.stores
      WHERE brand_code=$1 AND enabled=true
      ORDER BY sort_order NULLS LAST, store_code
      `,
      [brand]
    );

    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
