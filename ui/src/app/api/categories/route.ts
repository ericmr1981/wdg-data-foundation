import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgSchema, normalizeBrand } from '@/lib/brand-server';

// GET /api/categories?brand=yufeng
// 用途：给 UI 提供“字典表驱动”的分类下拉选项
// 约定：不把系统保留分类暴露给 UI（如 UNCLASSIFIED/OTHER_OUT），避免被误选
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const cfgSchema = getCfgSchema(brand);

    const reservedLvl1Codes = ['UNCLASSIFIED', 'OTHER_OUT'];

    const lvl1Res = await pool.query(
      `
      SELECT lvl1_code, lvl1_name, direction
      FROM ${cfgSchema}.dim_category_lvl1
      WHERE enabled = true
        AND lvl1_code <> ALL($1::text[])
      ORDER BY COALESCE(sort_order, 999999) ASC, lvl1_code ASC
      `,
      [reservedLvl1Codes]
    );

    const lvl2Res = await pool.query(
      `
      SELECT lvl1_code, lvl2_code, lvl2_name
      FROM ${cfgSchema}.dim_category_lvl2
      WHERE enabled = true
      ORDER BY COALESCE(sort_order, 999999) ASC, lvl2_code ASC
      `
    );

    const lvl2ByLvl1: Record<string, Array<{ lvl2_code: string; lvl2_name: string }>> = {};
    for (const r of lvl2Res.rows) {
      if (!lvl2ByLvl1[r.lvl1_code]) lvl2ByLvl1[r.lvl1_code] = [];
      lvl2ByLvl1[r.lvl1_code].push({ lvl2_code: r.lvl2_code, lvl2_name: r.lvl2_name });
    }

    return NextResponse.json({
      success: true,
      data: {
        lvl1: lvl1Res.rows,
        lvl2ByLvl1
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch categories' }, { status: 500 });
  }
}
