import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

function normName(name: string) {
  const n = String(name || '').trim();
  if (!n) throw Object.assign(new Error('Missing group_name'), { status: 400 });
  if (n.length > 64) throw Object.assign(new Error('group_name too long'), { status: 400 });
  return n;
}

// GET /api/admin/rule-groups?brand=yufeng
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    const { searchParams } = new URL(request.url);
    const brand = String(searchParams.get('brand') || '').trim() || 'yufeng';

    const res = await pool.query(
      `SELECT * FROM ops.rule_groups WHERE brand_code=$1 ORDER BY sort_order ASC, group_name ASC`,
      [brand]
    );
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// POST /api/admin/rule-groups
// body: { brand, group_name, sort_order? }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    const body = await request.json();
    const brand = String(body.brand || '').trim() || 'yufeng';
    const group_name = normName(body.group_name);
    const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 9999;

    await pool.query(
      `
      INSERT INTO ops.rule_groups (brand_code, group_name, sort_order)
      VALUES ($1,$2,$3)
      ON CONFLICT (brand_code, group_name) DO UPDATE
        SET sort_order=EXCLUDED.sort_order, enabled=true, updated_at=NOW()
      `,
      [brand, group_name, sort_order]
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
