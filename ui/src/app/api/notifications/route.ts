import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';
import type { NotificationListResponse } from '@/lib/notification-types';
import {
  listNotificationsSql,
  countUnreadNotificationsSql,
  buildNotificationListResponse,
  type NotificationRow,
  type CountRow,
} from '@/lib/notification-queries';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = user.user_id;  // NOTE: SessionUser uses user_id (UUID string), not id
  try {
    const [listRes, countRes] = await Promise.all([
      pool.query(listNotificationsSql(userId), [userId]),
      pool.query(countUnreadNotificationsSql(userId), [userId]),
    ]);
    const body: NotificationListResponse = buildNotificationListResponse(
      listRes.rows as NotificationRow[],
      countRes.rows as CountRow[],
    );
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
