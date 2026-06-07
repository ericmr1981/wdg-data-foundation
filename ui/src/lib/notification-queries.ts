// ui/src/lib/notification-queries.ts
// Pure data-access helpers for /api/notifications. Extracted from route.ts so
// they can be tested with `node --test --experimental-strip-types` (which
// cannot load `next/server`).

import type { NotificationItem } from './notification-types.ts';

export interface NotificationQueryResult {
  unread_count: number;
  items: NotificationItem[];
}

export interface NotificationRow {
  id: number | string;
  type: string;
  brand_code: string | null;
  severity: string;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  related_id: number | string | null;
  created_at: Date | string;
  is_read: boolean;
}

export interface CountRow {
  cnt: number;
}

export function listNotificationsSql(userId: string): string {
  return `
    SELECT n.id, n.type, n.brand_code, n.severity, n.title, n.body,
           n.action_url, n.action_label, n.related_id, n.created_at,
           (nr.user_id IS NOT NULL) AS is_read
    FROM ops.notification n
    LEFT JOIN ops.notification_read nr
      ON nr.notification_id = n.id AND nr.user_id = $1
    WHERE n.status = 'active'
    ORDER BY CASE n.severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
             n.created_at DESC
    LIMIT 100
  `;
}

export function countUnreadNotificationsSql(userId: string): string {
  return `
    SELECT COUNT(*)::int AS cnt
    FROM ops.notification n
    WHERE n.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM ops.notification_read nr
        WHERE nr.notification_id = n.id AND nr.user_id = $1
      )
  `;
}

export function buildNotificationListResponse(
  listRows: NotificationRow[],
  countRows: CountRow[],
): NotificationQueryResult {
  const items: NotificationItem[] = listRows.map((r) => ({
    id: Number(r.id),
    type: r.type as NotificationItem['type'],
    brand_code: r.brand_code,
    severity: r.severity as NotificationItem['severity'],
    title: r.title,
    body: r.body,
    action_url: r.action_url,
    action_label: r.action_label,
    related_id: r.related_id ? Number(r.related_id) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    is_read: Boolean(r.is_read),
  }));
  return {
    unread_count: countRows[0]?.cnt ?? 0,
    items,
  };
}
