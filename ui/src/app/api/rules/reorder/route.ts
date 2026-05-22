import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getCfgRuleTable } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// POST /api/rules/reorder
// body: { brand, ordered_rule_ids: number[], base_priority?: number, step?: number }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const body = await request.json();
    const brand = normalizeBrand(body.brand || 'yufeng');
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const ordered: number[] = Array.isArray(body.ordered_rule_ids)
      ? body.ordered_rule_ids.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      : [];

    if (ordered.length < 2) {
      return NextResponse.json({ success: false, error: 'Need at least 2 rule_ids' }, { status: 400 });
    }

    const base = Number.isFinite(Number(body.base_priority)) ? Number(body.base_priority) : 1000;
    const step = Number.isFinite(Number(body.step)) ? Number(body.step) : 10;

    const ruleTable = getCfgRuleTable(brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      // Update priority using unnest with ordinality
      // priority = base + (ord-1)*step
      const res = await client.query(
        `
        WITH x AS (
          SELECT *
          FROM unnest($1::bigint[]) WITH ORDINALITY AS t(rule_id, ord)
        )
        UPDATE ${ruleTable} r
        SET priority = $2 + (x.ord - 1) * $3,
            updated_at = NOW()
        FROM x
        WHERE r.rule_id = x.rule_id
        `,
        [ordered, base, step]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { updated: res.rowCount } });
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
