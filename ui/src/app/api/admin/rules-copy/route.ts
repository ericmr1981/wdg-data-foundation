import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand, getCfgSchema } from '@/lib/brand-server';

// POST /api/admin/rules-copy
// body: { from_brand, to_brand, mode: 'overwrite' }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const from_brand = normalizeBrand(body.from_brand);
    const to_brand = normalizeBrand(body.to_brand);
    const mode = body.mode || 'overwrite';

    if (!from_brand || !to_brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }
    if (from_brand === to_brand) {
      return NextResponse.json({ success: false, error: 'from_brand == to_brand' }, { status: 400 });
    }
    if (mode !== 'overwrite') {
      return NextResponse.json({ success: false, error: 'Only mode=overwrite supported (S2)' }, { status: 400 });
    }

    const fromCfg = getCfgSchema(from_brand);
    const toCfg = getCfgSchema(to_brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL wdg.user = $1', [user?.username || 'unknown']);

      // 1) overwrite existing (key match)
      const upd = await client.query(
        `
        UPDATE ${toCfg}.bank_rule_map t
        SET enabled = s.enabled,
            priority = s.priority,
            direction = s.direction,
            match_field = s.match_field,
            match_type = s.match_type,
            match_value = s.match_value,
            match_field2 = s.match_field2,
            match_value2 = s.match_value2,
            lvl1_code = s.lvl1_code,
            lvl2_code = s.lvl2_code,
            note = COALESCE(s.note, t.note),
            updated_at = NOW(),
            created_by = 'copy'
        FROM ${fromCfg}.bank_rule_map s
        WHERE t.match_field = s.match_field
          AND t.match_type = s.match_type
          AND t.match_value = s.match_value
          AND COALESCE(t.direction,'any') = COALESCE(s.direction,'any')
          AND COALESCE(t.match_field2,'') = COALESCE(s.match_field2,'')
          AND COALESCE(t.match_value2,'') = COALESCE(s.match_value2,'')
        RETURNING t.rule_id
        `
      );

      // 2) insert missing
      const ins = await client.query(
        `
        INSERT INTO ${toCfg}.bank_rule_map (
          enabled, priority, direction,
          match_field, match_type, match_value,
          match_field2, match_value2,
          lvl1_code, lvl2_code,
          note, created_by
        )
        SELECT
          s.enabled, s.priority, s.direction,
          s.match_field, s.match_type, s.match_value,
          s.match_field2, s.match_value2,
          s.lvl1_code, s.lvl2_code,
          s.note,
          'copy'
        FROM ${fromCfg}.bank_rule_map s
        WHERE NOT EXISTS (
          SELECT 1 FROM ${toCfg}.bank_rule_map t
          WHERE t.match_field = s.match_field
            AND t.match_type = s.match_type
            AND t.match_value = s.match_value
            AND COALESCE(t.direction,'any') = COALESCE(s.direction,'any')
            AND COALESCE(t.match_field2,'') = COALESCE(s.match_field2,'')
            AND COALESCE(t.match_value2,'') = COALESCE(s.match_value2,'')
        )
        RETURNING rule_id
        `
      );

      await client.query('COMMIT');
      return NextResponse.json({
        success: true,
        data: {
          from_brand,
          to_brand,
          updated: upd.rowCount,
          inserted: ins.rowCount
        }
      });
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
