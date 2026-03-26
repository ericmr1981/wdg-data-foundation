import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { resolveBrandCfgSchema } from '../_shared';
import { ensureBrandCategoryTables } from '../../category-dictionary/_ddl';

// POST /api/admin/brand-category-dictionary/copy-from-yufeng
// body: { brand, mode: 'merge'|'overwrite' }
// Notes:
// - overwrite: upsert (default), does not delete brand-only rows.
// - merge: only inserts missing rows.
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const { cfgSchema, brand } = await resolveBrandCfgSchema(body.brand);

    const mode = String(body.mode || 'overwrite');
    if (!['merge', 'overwrite'].includes(mode)) {
      return NextResponse.json({ success: false, error: 'Invalid mode (merge|overwrite)' }, { status: 400 });
    }

    // ensure source exists
    await ensureBrandCategoryTables('yufeng_cfg');

    const reservedLvl1Codes = ['UNCLASSIFIED', 'OTHER_OUT'];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      const lvl1Sql = mode === 'merge'
        ? `
          INSERT INTO ${cfgSchema}.dim_category_lvl1 (lvl1_code, lvl1_name, direction, enabled, sort_order)
          SELECT lvl1_code, lvl1_name, direction, enabled, sort_order
          FROM yufeng_cfg.dim_category_lvl1
          WHERE lvl1_code <> ALL($1::text[])
          ON CONFLICT (lvl1_code) DO NOTHING
        `
        : `
          INSERT INTO ${cfgSchema}.dim_category_lvl1 (lvl1_code, lvl1_name, direction, enabled, sort_order)
          SELECT lvl1_code, lvl1_name, direction, enabled, sort_order
          FROM yufeng_cfg.dim_category_lvl1
          WHERE lvl1_code <> ALL($1::text[])
          ON CONFLICT (lvl1_code) DO UPDATE
          SET lvl1_name = EXCLUDED.lvl1_name,
              direction = EXCLUDED.direction,
              enabled = EXCLUDED.enabled,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW()
        `;

      const lvl2Sql = mode === 'merge'
        ? `
          INSERT INTO ${cfgSchema}.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, enabled, sort_order)
          SELECT lvl1_code, lvl2_code, lvl2_name, enabled, sort_order
          FROM yufeng_cfg.dim_category_lvl2
          WHERE lvl1_code <> ALL($1::text[])
          ON CONFLICT (lvl1_code, lvl2_code) DO NOTHING
        `
        : `
          INSERT INTO ${cfgSchema}.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, enabled, sort_order)
          SELECT lvl1_code, lvl2_code, lvl2_name, enabled, sort_order
          FROM yufeng_cfg.dim_category_lvl2
          WHERE lvl1_code <> ALL($1::text[])
          ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE
          SET lvl2_name = EXCLUDED.lvl2_name,
              enabled = EXCLUDED.enabled,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW()
        `;

      const r1 = await client.query(lvl1Sql, [reservedLvl1Codes]);
      const r2 = await client.query(lvl2Sql, [reservedLvl1Codes]);

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { brand, mode, lvl1_upsert: r1.rowCount || 0, lvl2_upsert: r2.rowCount || 0 } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err?.status || 500;
    // Log for debugging (dev only)
    console.error('copy-from-yufeng failed:', { status, code: err?.code, message: err?.message });
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed', code: err?.code },
      { status }
    );
  }
}
