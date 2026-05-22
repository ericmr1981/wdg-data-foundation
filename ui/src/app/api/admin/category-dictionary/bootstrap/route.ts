import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { ensureDefaultCategoryTables, ensureBrandCategoryTables } from '../_ddl';

// POST /api/admin/category-dictionary/bootstrap
// body: { from_brand?: 'yufeng', mode?: 'merge'|'overwrite' }
// Purpose: seed default dictionary from an existing brand dictionary.
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    await ensureDefaultCategoryTables();

    const body = await request.json().catch(() => ({}));
    const from = String(body.from_brand || 'yufeng').trim();
    if (from !== 'yufeng') {
      return NextResponse.json({ success: false, error: 'Only yufeng supported for bootstrap now' }, { status: 400 });
    }

    const mode = String(body.mode || 'merge');
    if (!['merge', 'overwrite'].includes(mode)) {
      return NextResponse.json({ success: false, error: 'Invalid mode (merge|overwrite)' }, { status: 400 });
    }

    // Ensure source tables exist (yufeng)
    await ensureBrandCategoryTables('yufeng_cfg');

    const reservedLvl1Codes = ['UNCLASSIFIED', 'OTHER_OUT'];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      if (mode === 'overwrite') {
        // soft overwrite: we upsert; we don't delete existing default rows.
      }

      const r1 = await client.query(
        `
        INSERT INTO ops.category_lvl1_default (lvl1_code, lvl1_name, direction, enabled, sort_order)
        SELECT lvl1_code, lvl1_name, direction, enabled, sort_order
        FROM yufeng_cfg.dim_category_lvl1
        WHERE lvl1_code <> ALL($1::text[])
        ON CONFLICT (lvl1_code) DO UPDATE
        SET lvl1_name = EXCLUDED.lvl1_name,
            direction = EXCLUDED.direction,
            enabled = EXCLUDED.enabled,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
        `,
        [reservedLvl1Codes]
      );

      const r2 = await client.query(
        `
        INSERT INTO ops.category_lvl2_default (lvl1_code, lvl2_code, lvl2_name, enabled, sort_order)
        SELECT l2.lvl1_code, l2.lvl2_code, l2.lvl2_name, l2.enabled, l2.sort_order
        FROM yufeng_cfg.dim_category_lvl2 l2
        JOIN yufeng_cfg.dim_category_lvl1 l1 ON l2.lvl1_code = l1.lvl1_code
        WHERE l2.lvl1_code <> ALL($1::text[])
        ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE
        SET lvl2_name = EXCLUDED.lvl2_name,
            enabled = EXCLUDED.enabled,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
        `,
        [reservedLvl1Codes]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { lvl1_upsert: r1.rowCount || 0, lvl2_upsert: r2.rowCount || 0 } });
    } catch (e: any) {
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
