import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { ensureDefaultCategoryTables, ensureBrandCategoryTables } from '../_ddl';
import { getCfgSchema, normalizeBrand } from '@/lib/brand-server';

async function getTargetBrands(input?: any): Promise<string[]> {
  // input can be: undefined (all enabled), 'all', string[], or comma-separated string.
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

// POST /api/admin/category-dictionary/preview
// body: { brands?: 'all' | string[] }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    await ensureDefaultCategoryTables();

    const body = await request.json().catch(() => ({}));
    const brands = await getTargetBrands(body.brands);

    const out: any[] = [];

    for (const brand of brands) {
      const cfgSchema = getCfgSchema(brand);
      await ensureBrandCategoryTables(cfgSchema);

      const lvl1MissingRes = await pool.query(
        `
        SELECT count(*)::int AS cnt
        FROM ops.category_lvl1_default d
        LEFT JOIN ${cfgSchema}.dim_category_lvl1 b ON d.lvl1_code = b.lvl1_code
        WHERE b.lvl1_code IS NULL
        `
      );

      const lvl1DiffRes = await pool.query(
        `
        SELECT count(*)::int AS cnt
        FROM ops.category_lvl1_default d
        JOIN ${cfgSchema}.dim_category_lvl1 b ON d.lvl1_code = b.lvl1_code
        WHERE (b.lvl1_name, b.direction, b.enabled, COALESCE(b.sort_order, -1))
              IS DISTINCT FROM
              (d.lvl1_name, d.direction, d.enabled, COALESCE(d.sort_order, -1))
        `
      );

      const lvl2MissingRes = await pool.query(
        `
        SELECT count(*)::int AS cnt
        FROM ops.category_lvl2_default d
        LEFT JOIN ${cfgSchema}.dim_category_lvl2 b
          ON d.lvl1_code = b.lvl1_code AND d.lvl2_code = b.lvl2_code
        WHERE b.lvl2_code IS NULL
        `
      );

      const lvl2DiffRes = await pool.query(
        `
        SELECT count(*)::int AS cnt
        FROM ops.category_lvl2_default d
        JOIN ${cfgSchema}.dim_category_lvl2 b
          ON d.lvl1_code = b.lvl1_code AND d.lvl2_code = b.lvl2_code
        WHERE (b.lvl2_name, b.enabled, COALESCE(b.sort_order, -1))
              IS DISTINCT FROM
              (d.lvl2_name, d.enabled, COALESCE(d.sort_order, -1))
        `
      );

      out.push({
        brand,
        lvl1_missing: lvl1MissingRes.rows?.[0]?.cnt ?? 0,
        lvl1_diff: lvl1DiffRes.rows?.[0]?.cnt ?? 0,
        lvl2_missing: lvl2MissingRes.rows?.[0]?.cnt ?? 0,
        lvl2_diff: lvl2DiffRes.rows?.[0]?.cnt ?? 0,
      });
    }

    return NextResponse.json({ success: true, data: out });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
