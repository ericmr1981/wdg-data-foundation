import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/rules/history?brand=yufeng&rule_id=123&limit=50
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const ruleId = searchParams.get('rule_id');
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200);

    const res = await pool.query(
      `
      SELECT history_id, brand_code, cfg_schema, rule_id, op, changed_by, changed_at, before_row, after_row
      FROM ops.bank_rule_map_history
      WHERE brand_code = $1
        AND ($2::bigint IS NULL OR rule_id = $2::bigint)
      ORDER BY changed_at DESC, history_id DESC
      LIMIT $3
      `,
      [brand, ruleId ? Number(ruleId) : null, limit]
    );

    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
