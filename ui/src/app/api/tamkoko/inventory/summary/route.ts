import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import type {
  InventorySummaryRow,
  UpsertInventorySummaryRequest,
} from '@/lib/inventory-summary-types';

export const dynamic = 'force-dynamic';

const PERIOD_RE = /^\d{4}-\d{2}$/;

function validatePeriod(p: unknown): p is string {
  return typeof p === 'string' && PERIOD_RE.test(p);
}

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    assertRole(user, ['admin', 'operator']);
    const url = new URL(req.url);
    const store_code = url.searchParams.get('store_code');
    const period = url.searchParams.get('period');

    const params: unknown[] = [];
    const filters: string[] = [];
    if (store_code) { params.push(store_code); filters.push(`m.store_code = $${params.length}`); }
    if (period)     { params.push(period);     filters.push(`m.period = $${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const sql = `
      SELECT
        m.store_code, m.period, m.total_amount, m.note, m.updated_by,
        m.created_at, m.updated_at,
        s.store_name,
        v.cogs_amt, v.opening_amt, v.closing_amt,
        v.turnover_times, v.turnover_days
      FROM brand_tamkoko_ods.inventory_monthly_summary m
      LEFT JOIN ops.stores s
        ON s.store_code = m.store_code AND s.brand_code = 'tamkoko'
      LEFT JOIN brand_tamkoko_dm.v_inventory_turnover v
        ON v.store_code = m.store_code AND v.period = m.period
      ${where}
      ORDER BY m.period DESC, m.store_code
    `;
    const res = await pool.query(sql, params);
    return NextResponse.json({ success: true, data: res.rows as InventorySummaryRow[] });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    const status = err.status ?? 500;
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status }
    );
  }
}

export async function POST(req: Request) {
  const client = await pool.connect();
  try {
    const user = await getSessionUser(req);
    assertRole(user, ['admin', 'operator']);
    const body = (await req.json()) as Partial<UpsertInventorySummaryRequest>;
    if (!body.store_code || !validatePeriod(body.period)) {
      return NextResponse.json(
        { success: false, error: 'store_code and period (YYYY-MM) required' },
        { status: 400 }
      );
    }
    if (typeof body.total_amount !== 'number' || body.total_amount < 0 || !isFinite(body.total_amount)) {
      return NextResponse.json(
        { success: false, error: 'total_amount must be a non-negative number' },
        { status: 400 }
      );
    }
    const note = body.note ?? null;

    await client.query('BEGIN');
    const oldRes = await client.query(
      `SELECT total_amount, note FROM brand_tamkoko_ods.inventory_monthly_summary
        WHERE store_code = $1 AND period = $2 FOR UPDATE`,
      [body.store_code, body.period]
    );
    const old = oldRes.rows[0] ?? null;

    await client.query(
      `INSERT INTO brand_tamkoko_ods.inventory_monthly_summary
         (store_code, period, total_amount, note, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (store_code, period) DO UPDATE
         SET total_amount = EXCLUDED.total_amount,
             note         = EXCLUDED.note,
             updated_by   = EXCLUDED.updated_by,
             updated_at   = NOW()`,
      [body.store_code, body.period, body.total_amount, note, user!.username]
    );

    await client.query(
      `INSERT INTO ops.audit_log
         (entity_type, entity_key, action, actor, payload)
       VALUES ('inventory_summary', $1, 'upsert', $2, $3::jsonb)`,
      [
        `tamkoko:${body.store_code}:${body.period}`,
        user!.username,
        JSON.stringify({ old, new: { total_amount: body.total_amount, note } }),
      ]
    );

    const out = await client.query(
      `SELECT m.store_code, m.period, m.total_amount, m.note, m.updated_by,
              m.created_at, m.updated_at,
              s.store_name,
              v.cogs_amt, v.opening_amt, v.closing_amt,
              v.turnover_times, v.turnover_days
         FROM brand_tamkoko_ods.inventory_monthly_summary m
         LEFT JOIN ops.stores s
           ON s.store_code = m.store_code AND s.brand_code = 'tamkoko'
         LEFT JOIN brand_tamkoko_dm.v_inventory_turnover v
           ON v.store_code = m.store_code AND v.period = m.period
        WHERE m.store_code = $1 AND m.period = $2`,
      [body.store_code, body.period]
    );
    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: out.rows[0] as InventorySummaryRow });
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const err = e as { status?: number };
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status: err.status ?? 500 }
    );
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const client = await pool.connect();
  try {
    const user = await getSessionUser(req);
    assertRole(user, ['admin']);
    const url = new URL(req.url);
    const store_code = url.searchParams.get('store_code');
    const period = url.searchParams.get('period');
    if (!store_code || !validatePeriod(period)) {
      return NextResponse.json(
        { success: false, error: 'store_code and period (YYYY-MM) required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');
    const oldRes = await client.query(
      `SELECT total_amount, note FROM brand_tamkoko_ods.inventory_monthly_summary
        WHERE store_code = $1 AND period = $2 FOR UPDATE`,
      [store_code, period]
    );
    if (oldRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'not found' },
        { status: 404 }
      );
    }
    const old = oldRes.rows[0];
    const stamp = new Date().toISOString();

    await client.query(
      `UPDATE brand_tamkoko_ods.inventory_monthly_summary
          SET total_amount = 0,
              note = $3,
              updated_by = $4,
              updated_at = NOW()
        WHERE store_code = $1 AND period = $2`,
      [store_code, period, `deleted ${stamp}`, user!.username]
    );

    await client.query(
      `INSERT INTO ops.audit_log
         (entity_type, entity_key, action, actor, payload)
       VALUES ('inventory_summary', $1, 'soft_delete', $2, $3::jsonb)`,
      [
        `tamkoko:${store_code}:${period}`,
        user!.username,
        JSON.stringify({ old, deleted_at: stamp }),
      ]
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const err = e as { status?: number };
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status: err.status ?? 500 }
    );
  } finally {
    client.release();
  }
}