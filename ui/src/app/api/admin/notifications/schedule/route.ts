import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const TASKS: readonly string[] = ['data_stale', 'unmatched_txn', 'dup_rule', 'monthly_report'];

// Lightweight 5-field cron syntax check (m/h/d/M/dow). Deep semantics
// (e.g. Feb 30) are validated by the wdg-scheduler daemon on reload.
function isValidCron(expr: string): boolean {
  if (typeof expr !== 'string') return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const ranges = [
    [0, 59],   // minute
    [0, 23],   // hour
    [1, 31],   // day of month
    [1, 12],   // month
    [0, 7],    // day of week (0 and 7 both = Sunday)
  ];
  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    // field may be: *, */n, n, n-m, n-m/k, list (comma)
    for (const token of part.split(',')) {
      const stepMatch = token.match(/^(.+)\/(\d+)$/);
      const base = stepMatch ? stepMatch[1] : token;
      if (base !== '*' && !/^\d+(-\d+)?$/.test(base)) return false;
      if (base.includes('-')) {
        const [a, b] = base.split('-').map(Number);
        if (a < ranges[i][0] || b > ranges[i][1] || a > b) return false;
      } else if (base !== '*') {
        const n = Number(base);
        if (n < ranges[i][0] || n > ranges[i][1]) return false;
      }
    }
  }
  return true;
}

export async function GET(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    assertRole(user, ['admin']);
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, task_name, enabled, cron_expr, brands_filter, description, updated_at
       FROM ops.notification_schedule
       ORDER BY id`,
    );
    return NextResponse.json({ items: rows });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    assertRole(user, ['admin']);
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let body: { items: Array<{ task_name: string; enabled: boolean; cron_expr: string; brands_filter: string | null }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items[] required' }, { status: 400 });
  }
  // 校验 cron + task_name
  for (const it of body.items) {
    if (!TASKS.includes(it.task_name)) {
      return NextResponse.json({ error: `unknown task: ${it.task_name}` }, { status: 400 });
    }
    try {
      if (!isValidCron(it.cron_expr)) throw new Error('bad cron');
    } catch {
      return NextResponse.json({ error: `invalid cron for ${it.task_name}: ${it.cron_expr}` }, { status: 400 });
    }
  }
  try {
    for (const it of body.items) {
      await pool.query(
        `UPDATE ops.notification_schedule
         SET enabled = $1, cron_expr = $2, brands_filter = $3,
             updated_at = now(), updated_by = $4
         WHERE task_name = $5`,
        [it.enabled, it.cron_expr, it.brands_filter, user.user_id, it.task_name],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
