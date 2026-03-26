import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { ensureDefaultCategoryTables, ensureBrandCategoryTables } from '../_ddl';
import { getCfgSchema, normalizeBrand } from '@/lib/brand-server';

async function getTargetBrands(input?: any): Promise<string[]> {
  if (!input || input === 'all') {
    const res = await pool.query(`SELECT brand_code FROM ops.brands WHERE enabled=true ORDER BY sort_order NULLS LAST, brand_code`);
    return res.rows.map((r) => String(r.brand_code));
  }
  if (Array.isArray(input)) {
    return input.map((x) => String(x)).map((b) => normalizeBrand(b)).filter(Boolean) as string[];
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((s) => s.trim())
      .map((b) => normalizeBrand(b))
      .filter(Boolean) as string[];
  }
  return [];
}

// POST /api/admin/category-dictionary/sync
// body: { brands?: 'all' | string[], mode: 'safe'|'force' }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    await ensureDefaultCategoryTables();

    const body = await request.json();
    const mode = String(body.mode || 'safe');
    if (!['safe', 'force'].includes(mode)) {
      return NextResponse.json({ success: false, error: 'Invalid mode (safe|force)' }, { status: 400 });
    }

    const brands = await getTargetBrands(body.brands);
    if (brands.length === 0) {
      return NextResponse.json({ success: false, error: 'No brands' }, { status: 400 });
    }

    const results: any[] = [];

    for (const brand of brands) {
      const cfgSchema = getCfgSchema(brand);
      await ensureBrandCategoryTables(cfgSchema);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

        let lvl1Upsert = 0;
        let lvl2Upsert = 0;

        if (mode === 'safe') {
          const r1 = await client.query(
            `
            INSERT INTO ${cfgSchema}.dim_category_lvl1 (lvl1_code, lvl1_name, direction, enabled, sort_order)
            SELECT lvl1_code, lvl1_name, direction, enabled, sort_order
            FROM ops.category_lvl1_default
            ON CONFLICT (lvl1_code) DO NOTHING
            `
          );
          lvl1Upsert = r1.rowCount || 0;

          const r2 = await client.query(
            `
            INSERT INTO ${cfgSchema}.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, enabled, sort_order)
            SELECT lvl1_code, lvl2_code, lvl2_name, enabled, sort_order
            FROM ops.category_lvl2_default
            ON CONFLICT (lvl1_code, lvl2_code) DO NOTHING
            `
          );
          lvl2Upsert = r2.rowCount || 0;
        } else {
          const r1 = await client.query(
            `
            INSERT INTO ${cfgSchema}.dim_category_lvl1 (lvl1_code, lvl1_name, direction, enabled, sort_order)
            SELECT lvl1_code, lvl1_name, direction, enabled, sort_order
            FROM ops.category_lvl1_default
            ON CONFLICT (lvl1_code) DO UPDATE
            SET lvl1_name = EXCLUDED.lvl1_name,
                direction = EXCLUDED.direction,
                enabled = EXCLUDED.enabled,
                sort_order = EXCLUDED.sort_order,
                updated_at = NOW()
            `
          );
          lvl1Upsert = r1.rowCount || 0;

          const r2 = await client.query(
            `
            INSERT INTO ${cfgSchema}.dim_category_lvl2 (lvl1_code, lvl2_code, lvl2_name, enabled, sort_order)
            SELECT lvl1_code, lvl2_code, lvl2_name, enabled, sort_order
            FROM ops.category_lvl2_default
            ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE
            SET lvl2_name = EXCLUDED.lvl2_name,
                enabled = EXCLUDED.enabled,
                sort_order = EXCLUDED.sort_order,
                updated_at = NOW()
            `
          );
          lvl2Upsert = r2.rowCount || 0;
        }

        await client.query('COMMIT');
        results.push({ brand, ok: true, mode, lvl1_upsert: lvl1Upsert, lvl2_upsert: lvl2Upsert });
      } catch (e: any) {
        await client.query('ROLLBACK');
        results.push({ brand, ok: false, error: e?.message || String(e) });
      } finally {
        client.release();
      }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
