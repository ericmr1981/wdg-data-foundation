import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { ensureDefaultCategoryTables } from '../_ddl';

function normLvl1Code(code: any) {
  const c = String(code || '').trim();
  if (!/^[A-Z0-9_]{2,32}$/.test(c)) {
    throw Object.assign(new Error('Invalid lvl1_code (use A-Z0-9_)'), { status: 400 });
  }
  return c;
}

function normLvl2Code(code: any) {
  const c = String(code || '').trim();
  if (!/^[A-Z0-9_]{2,32}$/.test(c)) {
    throw Object.assign(new Error('Invalid lvl2_code (use A-Z0-9_)'), { status: 400 });
  }
  return c;
}

// GET /api/admin/category-dictionary/lvl2?lvl1_code=XXX(optional)
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    await ensureDefaultCategoryTables();

    const { searchParams } = new URL(request.url);
    const lvl1 = searchParams.get('lvl1_code');

    const res = lvl1
      ? await pool.query(
          `
          SELECT lvl1_code, lvl2_code, lvl2_name, enabled, sort_order, updated_at
          FROM ops.category_lvl2_default
          WHERE lvl1_code = $1
          ORDER BY COALESCE(sort_order, 999999) ASC, lvl2_code ASC
          `,
          [normLvl1Code(lvl1)]
        )
      : await pool.query(
          `
          SELECT lvl1_code, lvl2_code, lvl2_name, enabled, sort_order, updated_at
          FROM ops.category_lvl2_default
          ORDER BY lvl1_code ASC, COALESCE(sort_order, 999999) ASC, lvl2_code ASC
          `
        );

    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// POST /api/admin/category-dictionary/lvl2
// body: { lvl1_code, lvl2_code, lvl2_name, enabled?, sort_order? }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    await ensureDefaultCategoryTables();

    const body = await request.json();
    const lvl1_code = normLvl1Code(body.lvl1_code);
    const lvl2_code = normLvl2Code(body.lvl2_code);
    const lvl2_name = String(body.lvl2_name || '').trim() || lvl2_code;
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const sort_order = body.sort_order === undefined || body.sort_order === null ? null : Number(body.sort_order);

    await pool.query(
      `
      INSERT INTO ops.category_lvl2_default (lvl1_code, lvl2_code, lvl2_name, enabled, sort_order)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (lvl1_code, lvl2_code) DO UPDATE
      SET lvl2_name = EXCLUDED.lvl2_name,
          enabled = EXCLUDED.enabled,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
      `,
      [lvl1_code, lvl2_code, lvl2_name, enabled, Number.isFinite(sort_order as any) ? sort_order : null]
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// PUT /api/admin/category-dictionary/lvl2
// body: { lvl1_code, lvl2_code, ...fields }
export async function PUT(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    await ensureDefaultCategoryTables();

    const body = await request.json();
    const lvl1_code = normLvl1Code(body.lvl1_code);
    const lvl2_code = normLvl2Code(body.lvl2_code);

    const patches: string[] = [];
    const values: any[] = [];
    let i = 1;

    const add = (col: string, val: any) => {
      patches.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (body.lvl2_name !== undefined) add('lvl2_name', String(body.lvl2_name || '').trim() || lvl2_code);
    if (body.enabled !== undefined) add('enabled', Boolean(body.enabled));
    if (body.sort_order !== undefined) {
      const v = body.sort_order === null || body.sort_order === '' ? null : Number(body.sort_order);
      add('sort_order', Number.isFinite(v as any) ? v : null);
    }

    if (patches.length === 0) {
      return NextResponse.json({ success: true });
    }

    values.push(lvl1_code);
    values.push(lvl2_code);

    await pool.query(
      `
      UPDATE ops.category_lvl2_default
      SET ${patches.join(', ')}, updated_at = NOW()
      WHERE lvl1_code = $${i++} AND lvl2_code = $${i}
      `,
      values
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
