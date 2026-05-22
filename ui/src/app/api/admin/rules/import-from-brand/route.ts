import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getCfgRuleTable, getCfgSchema, normalizeBrand } from '@/lib/brand-server';

// POST /api/admin/rules/import-from-brand
// body: { from_brand: string, to_brand: string, mode?: 'merge'|'append' }
// merge: insert only when an equivalent rule doesn't exist in target
// append: always insert (may create duplicates)
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const body = await request.json();
    const from = normalizeBrand(body.from_brand);
    const to = normalizeBrand(body.to_brand);
    if (!from || !to) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (from === to) {
      return NextResponse.json({ success: false, error: 'from_brand and to_brand must differ' }, { status: 400 });
    }

    const mode = String(body.mode || 'merge');
    if (!['merge', 'append'].includes(mode)) {
      return NextResponse.json({ success: false, error: 'Invalid mode' }, { status: 400 });
    }

    const fromTable = getCfgRuleTable(from);
    const toTable = getCfgRuleTable(to);
    const toCfg = getCfgSchema(to);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      // Ensure target table exists (clone from yufeng as canonical structure)
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${toCfg};`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${toTable} (LIKE yufeng_cfg.bank_rule_map INCLUDING ALL);`);

      const insertSql = mode === 'append'
        ? `
          INSERT INTO ${toTable} (
            enabled, priority, direction,
            match_field, match_type, match_value,
            match_field2, match_value2,
            lvl1_code, lvl2_code,
            group_name,
            note
          )
          SELECT
            enabled, priority, direction,
            match_field, match_type, match_value,
            match_field2, match_value2,
            lvl1_code, lvl2_code,
            group_name,
            note
          FROM ${fromTable}
        `
        : `
          INSERT INTO ${toTable} (
            enabled, priority, direction,
            match_field, match_type, match_value,
            match_field2, match_value2,
            lvl1_code, lvl2_code,
            group_name,
            note
          )
          SELECT
            s.enabled, s.priority, s.direction,
            s.match_field, s.match_type, s.match_value,
            s.match_field2, s.match_value2,
            s.lvl1_code, s.lvl2_code,
            s.group_name,
            s.note
          FROM ${fromTable} s
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${toTable} t
            WHERE t.direction = s.direction
              AND t.match_field = s.match_field
              AND COALESCE(t.match_type, '') = COALESCE(s.match_type, '')
              AND t.match_value = s.match_value
              AND COALESCE(t.match_field2, '') = COALESCE(s.match_field2, '')
              AND COALESCE(t.match_value2, '') = COALESCE(s.match_value2, '')
              AND t.lvl1_code = s.lvl1_code
              AND COALESCE(t.lvl2_code, '') = COALESCE(s.lvl2_code, '')
              AND COALESCE(t.group_name, '') = COALESCE(s.group_name, '')
          )
        `;

      const r = await client.query(insertSql);

      // Also ensure rule_groups exist for target brand (so UI filters work)
      await client.query(
        `
        INSERT INTO ops.rule_groups (brand_code, group_name, sort_order, enabled)
        SELECT $1 as brand_code, g.group_name, 9999 as sort_order, true as enabled
        FROM (
          SELECT DISTINCT group_name
          FROM ${toTable}
          WHERE group_name IS NOT NULL AND group_name <> ''
        ) g
        ON CONFLICT (brand_code, group_name) DO UPDATE
        SET enabled = true,
            updated_at = NOW()
        `,
        [to]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { from_brand: from, to_brand: to, mode, inserted: r.rowCount || 0 } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('import-from-brand failed:', { status, code: err?.code, message: err?.message });
    return NextResponse.json({ success: false, error: err?.message || 'Failed', code: err?.code }, { status });
  }
}
