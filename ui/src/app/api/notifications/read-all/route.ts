import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await pool.query(
      `INSERT INTO ops.notification_read (notification_id, user_id)
       SELECT n.id, $1 FROM ops.notification n
       WHERE n.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM ops.notification_read nr
           WHERE nr.notification_id = n.id AND nr.user_id = $1
         )
       ON CONFLICT DO NOTHING`,
      [user.user_id],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
