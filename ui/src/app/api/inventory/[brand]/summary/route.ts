import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { getOdsSchema, getDmSchema, normalizeBrand } from '@/lib/brand-server';
import type {
  InventorySummaryRow,
  UpsertInventorySummaryRequest,
} from '@/lib/inventory-summary-types';

export const dynamic = 'force-dynamic';

const ALLOWED_BRANDS = new Set(['tamkoko', 'gelatomiiix']);
const PERIOD_RE = /^\d{4}-\d{2}$/;
const STORE_CODE_RE = /^[a-z][a-z0-9_]{1,30}$/;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceRow<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of [
    'total_amount',
    'cogs_amt', 'opening_amt', 'closing_amt',
    'turnover_times', 'turnover_days',
  ] as const) {
    if (k in out) out[k] = toNum(out[k]);
  }
  return out as T;
}

export async function GET(req: Request, ctx: { params: Promise<{ brand: string }> }) {
  const { brand: rawBrand } = await ctx.params;
  const brand = normalizeBrand(rawBrand) ?? '';
  if (!ALLOWED_BRANDS.has(brand)) {
    return NextResponse.json({ success: false, error: 'unknown brand' }, { status: 404 });
  }
  const odsSchema = getOdsSchema(brand);
  const useDmJoin = brand === 'tamkoko';
  const dmSchema = useDmJoin ? getDmSchema(brand) : null;

  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    assertRole(user, ['admin', 'operator']);
    const url = new URL(req.url);
    const store_code = url.searchParams.get('store_code');
    const period = url.searchParams.get('period');

    const params: unknown[] = [];
    const filters: string[] = [];
    if (store_code) { params.push(store_code); filters.push(`m.store_code = $${params.length}`); }
    if (period)     { params.push(period);     filters.push(`m.period = $${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const dmJoin = useDmJoin
      ? `LEFT JOIN ${dmSchema}.v_inventory_turnover v
           ON v.store_code = m.store_code AND v.period = m.period`
      : '';

    const sql = `
      SELECT
        m.store_code, m.period, m.total_amount, m.note, m.updated_by,
        m.created_at, m.updated_at,
        s.store_name,
        ${useDmJoin ? 'v.cogs_amt, v.opening_amt, v.closing_amt, v.turnover_times, v.turnover_days' : 'NULL::numeric AS cogs_amt, NULL::numeric AS opening_amt, NULL::numeric AS closing_amt, NULL::numeric AS turnover_times, NULL::numeric AS turnover_days'}
      FROM ${odsSchema}.inventory_monthly_summary m
      LEFT JOIN ops.stores s
        ON s.store_code = m.store_code AND s.brand_code = $${params.length + 1}
      ${dmJoin}
      ${where}
      ORDER BY m.period DESC, m.store_code
    `;
    params.push(brand);
    const res = await pool.query(sql, params);
    return NextResponse.json({
      success: true,
      data: (res.rows as unknown as Record<string, unknown>[]).map(coerceRow) as unknown as InventorySummaryRow[],
    });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    const status = err.status ?? 500;
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status }
    );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ brand: string }> }) {
  const { brand: rawBrand } = await ctx.params;
  const brand = normalizeBrand(rawBrand) ?? '';
  if (!ALLOWED_BRANDS.has(brand)) {
    return NextResponse.json({ success: false, error: 'unknown brand' }, { status: 404 });
  }
  const odsSchema = getOdsSchema(brand);

  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    assertRole(user, ['admin', 'operator']);
    const body = (await req.json()) as UpsertInventorySummaryRequest;
    const { store_code, period, total_amount, note } = body;

    if (typeof store_code !== 'string' || !STORE_CODE_RE.test(store_code)) {
      return NextResponse.json({ success: false, error: 'invalid store_code' }, { status: 400 });
    }
    if (typeof period !== 'string' || !PERIOD_RE.test(period)) {
      return NextResponse.json({ success: false, error: 'invalid period (YYYY-MM)' }, { status: 400 });
    }
    const amt = Number(total_amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ success: false, error: 'invalid total_amount' }, { status: 400 });
    }

    // Validate store_code belongs to this brand
    const storeCheck = await pool.query(
      `SELECT 1 FROM ops.stores WHERE brand_code = $1 AND store_code = $2 AND enabled = true`,
      [brand, store_code]
    );
    if ((storeCheck.rowCount ?? 0) === 0) {
      return NextResponse.json({ success: false, error: 'store not found for brand' }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO ${odsSchema}.inventory_monthly_summary
         (store_code, period, total_amount, note, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (store_code, period) DO UPDATE
         SET total_amount = EXCLUDED.total_amount,
             note = EXCLUDED.note,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [store_code, period, amt, note ?? null, user.username]
    );
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    const status = err.status ?? 500;
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status }
    );
  }
}
