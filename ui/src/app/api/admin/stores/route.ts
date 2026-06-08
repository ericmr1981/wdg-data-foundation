import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand, getCfgSchema } from '@/lib/brand-server';
import { handleCreateStore, type CreateStoreInput, type Caller } from '@/lib/admin-stores';
import { verifyMcpServiceToken } from '@/lib/mcp-service-token';

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
      `SELECT * FROM ops.stores WHERE brand_code=$1 AND enabled=true ORDER BY sort_order NULLS LAST, store_code`,
      [brand]
    );
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// POST /api/admin/stores — single entry point = handleCreateStore()
// Used by both admin UI and MCP (POST /api/mcp → /api/admin/stores).
//
// Response shape is a SUPERSET of both new and legacy contracts:
//   New (spec §2.1, MCP consumers):   { ok, store, rule_snapshot, code }
//   Legacy (admin UI page.tsx:75):    { success, data, error: <string> }
// The admin UI only reads data.success / data.error, so a single response
// that carries both old and new fields keeps both consumers happy.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, success: false, code: 'unauthenticated', error: 'No active session', data: null },
        { status: 401 }
      );
    }
    if (session.role !== 'admin') {
      return NextResponse.json(
        { ok: false, success: false, code: 'forbidden', error: 'Admin role required', data: null },
        { status: 403 }
      );
    }

    const isMcp = req.headers.get('x-mcp-session') === 'internal';
    let serviceTokenMatched = false;
    if (isMcp) {
      const provided = req.headers.get('x-service-token') ?? '';
      serviceTokenMatched = await verifyMcpServiceToken(provided);
      if (!serviceTokenMatched) {
        return NextResponse.json(
          { ok: false, success: false, code: 'forbidden_mcp', error: 'Invalid or missing service token', data: null },
          { status: 403 }
        );
      }
    }

    const body = (await req.json()) as CreateStoreInput;
    const caller: Caller = isMcp
      ? { kind: 'mcp', user: { id: session.user_id, role: session.role }, serviceTokenMatched }
      : { kind: 'admin_ui', user: { id: session.user_id, role: session.role } };

    const result = await handleCreateStore(body, caller);
    return NextResponse.json(
      {
        ok: true,
        success: true,                  // legacy admin UI compat
        data: result.store,             // legacy admin UI compat
        store: result.store,            // new (MCP / spec §2.1)
        rule_snapshot: result.rule_snapshot,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const code = e?.code ?? 'internal_error';
    const message = e?.message ?? 'Internal error';
    // Map spec §2.1 error codes → HTTP status. Anything not listed → 422.
    const STATUS: Record<string, number> = {
      unauthenticated: 401,
      forbidden: 403,
      forbidden_mcp: 403,
      brand_not_found: 404,
      internal_error: 500,
    };
    const status = STATUS[code] ?? 422;
    return NextResponse.json(
      { ok: false, success: false, code, error: message, data: null },
      { status }
    );
  }
}

// DELETE /api/admin/stores
// body: { brand, store_code }
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    const body = await request.json();
    const brand = normalizeBrand(body.brand || '');
    const store_code = normStoreCode(body.store_code);
    if (!brand || !store_code) {
      return NextResponse.json({ success: false, error: 'Missing brand or store_code' }, { status: 400 });
    }

    await pool.query(
      `UPDATE ops.stores SET enabled=false, updated_at=NOW() WHERE brand_code=$1 AND store_code=$2`,
      [brand, store_code]
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
