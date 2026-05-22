import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/rule-groups?brand=yufeng
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
    const { searchParams } = new URL(request.url);
    const brand = String(searchParams.get('brand') || '').trim() || 'yufeng';

    const res = await pool.query(
      `
      SELECT group_name, sort_order
      FROM ops.rule_groups
      WHERE brand_code=$1 AND enabled=true
      ORDER BY sort_order ASC, group_name ASC
      `,
      [brand]
    );

    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
