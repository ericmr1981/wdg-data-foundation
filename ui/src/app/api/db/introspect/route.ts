import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/introspect
 * Admin-only DB introspection (schemas/tables/views/columns).
 *
 * Query params:
 * - schema?: string  (when omitted -> list schemas)
 * - name?: string    (when provided with schema -> return columns for table/view)
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const { searchParams } = new URL(request.url);
    const schema = (searchParams.get('schema') || '').trim();
    const name = (searchParams.get('name') || '').trim();

    // 1) List schemas
    if (!schema) {
      const res = await pool.query(
        `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
          AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name
        `
      );
      return NextResponse.json({ success: true, data: res.rows });
    }

    // Basic allowlist pattern (avoid weird schema names)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) {
      return NextResponse.json({ success: false, error: 'Invalid schema' }, { status: 400 });
    }

    // 2) List objects in schema
    if (!name) {
      const res = await pool.query(
        `
        SELECT table_name AS name,
               CASE WHEN table_type='VIEW' THEN 'view' ELSE 'table' END AS kind
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY kind, name
        `,
        [schema]
      );
      return NextResponse.json({ success: true, data: res.rows });
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) {
      return NextResponse.json({ success: false, error: 'Invalid name' }, { status: 400 });
    }

    // 3) Columns for a given object
    const cols = await pool.query(
      `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        ordinal_position
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2
      ORDER BY ordinal_position
      `,
      [schema, name]
    );

    // 4) Best-effort: rowcount estimate (tables only)
    // Avoid heavy COUNT(*). Use pg_class.reltuples for estimate.
    const est = await pool.query(
      `
      SELECT c.reltuples::bigint AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      LIMIT 1
      `,
      [schema, name]
    );

    return NextResponse.json({
      success: true,
      data: {
        schema,
        name,
        columns: cols.rows,
        approx_rows: est.rows?.[0]?.approx_rows ?? null,
      },
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
