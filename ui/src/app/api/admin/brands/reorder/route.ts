import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// POST /api/admin/brands/reorder
// body: { ordered_brand_codes: string[] }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const ordered: string[] = Array.isArray(body.ordered_brand_codes) ? body.ordered_brand_codes.map((x: any) => String(x)) : [];
    if (ordered.length < 1) return NextResponse.json({ success: false, error: 'empty' }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL wdg.user = $1', [user?.username || 'unknown']);

      await client.query(
        `
        WITH x AS (
          SELECT unnest($1::text[]) AS brand_code, generate_series(1, array_length($1::text[], 1)) AS ord
        )
        UPDATE ops.brands b
        SET sort_order = (x.ord - 1) * 10,
            updated_at = NOW()
        FROM x
        WHERE b.brand_code = x.brand_code
        `,
        [ordered]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
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
