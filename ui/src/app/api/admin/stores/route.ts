import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand, getCfgSchema } from '@/lib/brand-server';

function normStoreCode(code: string) {
  const c = String(code || '').trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(c)) throw Object.assign(new Error('Invalid store_code'), { status: 400 });
  return c;
}

// GET /api/admin/stores?brand=xxx
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    const { searchParams } = new URL(request.url);
    const brand = normalizeBrand(searchParams.get('brand') || 'yufeng');
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const res = await pool.query(
      `SELECT * FROM ops.stores WHERE brand_code=$1 ORDER BY sort_order NULLS LAST, store_code`,
      [brand]
    );
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// POST /api/admin/stores
// body: { brand, store_code, store_name }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    const body = await request.json();

    const brand = normalizeBrand(body.brand || 'yufeng');
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const store_code = normStoreCode(body.store_code);
    const store_name = String(body.store_name || '').trim() || store_code;

    const cfgSchema = getCfgSchema(brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO ops.stores (brand_code, store_code, store_name)
        VALUES ($1,$2,$3)
        ON CONFLICT (brand_code, store_code) DO UPDATE SET store_name=EXCLUDED.store_name, enabled=true, updated_at=NOW()
        `,
        [brand, store_code, store_name]
      );

      // also upsert into cfg.dim_store (for dropdown used by metabase/ui)
      await client.query(
        `
        INSERT INTO ${cfgSchema}.dim_store (store_code, store_name)
        VALUES ($1,$2)
        ON CONFLICT (store_code) DO UPDATE SET store_name=EXCLUDED.store_name
        `,
        [store_code, store_name]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { brand, store_code, store_name } });
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
