import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/brands - list enabled brands for selector
export async function GET() {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
    const res = await pool.query(
      `SELECT brand_code, brand_name FROM ops.brands WHERE enabled=true ORDER BY brand_code`
    );
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
