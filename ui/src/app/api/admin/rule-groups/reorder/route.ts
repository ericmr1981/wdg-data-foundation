import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// POST /api/admin/rule-groups/reorder
// body: { brand, ordered_group_names: string[] }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const brand = String(body.brand || '').trim() || 'yufeng';
    const ordered: string[] = Array.isArray(body.ordered_group_names) ? body.ordered_group_names.map((x: any) => String(x)) : [];
    if (ordered.length < 1) return NextResponse.json({ success: false, error: 'empty' }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      // sort_order = index*10
      await client.query(
        `
        WITH x AS (
          SELECT unnest($1::text[]) AS group_name, generate_series(1, array_length($1::text[], 1)) AS ord
        )
        UPDATE ops.rule_groups g
        SET sort_order = (x.ord - 1) * 10,
            updated_at = NOW()
        FROM x
        WHERE g.brand_code = $2 AND g.group_name = x.group_name
        `,
        [ordered, brand]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
