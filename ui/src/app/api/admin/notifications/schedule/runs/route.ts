import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    assertRole(user, ['admin']);
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const taskName = url.searchParams.get('task_name');
  try {
    const sql = `
      SELECT id, task_name, started_at, finished_at, status,
             error_message, new_notifications, trigger_source
      FROM ops.notification_schedule_run
      ${taskName ? 'WHERE task_name = $1' : ''}
      ORDER BY started_at DESC NULLS LAST
      LIMIT 50
    `;
    const params = taskName ? [taskName] : [];
    const { rows } = await pool.query(sql, params);
    return NextResponse.json({ items: rows });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
