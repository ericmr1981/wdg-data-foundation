// ui/src/app/api/notifications/route.test.ts
// Test runner: `node --test --experimental-strip-types`
//
// Verifies the GET /api/notifications contract. The route handler itself
// imports `next/server`, which is not loadable under bare `node --test`, so
// we exercise the pure helpers that the route delegates to. This matches
// the project's existing pattern (ui/tests/chat/auth.test.ts →
// ui/src/lib/chat/auth.ts).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import {
  listNotificationsSql,
  countUnreadNotificationsSql,
  buildNotificationListResponse,
} from '../../../lib/notification-queries.ts';

const USER_ID = '00000000-0000-0000-0000-000000000042';

test('listNotificationsSql filters by status and left-joins notification_read', () => {
  const sql = listNotificationsSql(USER_ID);
  assert.match(sql, /FROM ops\.notification n/);
  assert.match(sql, /LEFT JOIN ops\.notification_read nr/);
  assert.match(sql, /nr\.user_id = \$1/);
  assert.match(sql, /n\.status = 'active'/);
  assert.match(sql, /LIMIT 100/);
  // The user id is bound as a parameter, not interpolated.
  assert.equal(sql.includes(USER_ID), false);
});

test('countUnreadNotificationsSql counts active notifications not yet read by user', () => {
  const sql = countUnreadNotificationsSql(USER_ID);
  assert.match(sql, /COUNT\(\*\)::int AS cnt/);
  assert.match(sql, /n\.status = 'active'/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /nr\.user_id = \$1/);
  assert.equal(sql.includes(USER_ID), false);
});

test('buildNotificationListResponse maps list rows + count row into the response shape', () => {
  const out = buildNotificationListResponse(
    [
      {
        id: 1,
        type: 'data_stale',
        brand_code: 'tamkoko',
        severity: 'warn',
        title: 't',
        body: 'b',
        action_url: '/x',
        action_label: 'L',
        related_id: null,
        created_at: new Date('2026-06-07T09:00:00Z'),
        is_read: false,
      },
    ],
    [{ cnt: 1 }],
  );

  assert.equal(out.unread_count, 1);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, 1);
  assert.equal(out.items[0].is_read, false);
  assert.equal(out.items[0].title, 't');
  assert.equal(out.items[0].created_at, '2026-06-07T09:00:00.000Z');
});

test('buildNotificationListResponse tolerates string ids and string dates from pg', () => {
  const out = buildNotificationListResponse(
    [
      {
        id: '42',
        type: 'unmatched_txn',
        brand_code: null,
        severity: 'error',
        title: 'unmatched',
        body: '',
        action_url: null,
        action_label: null,
        related_id: '7',
        created_at: '2026-06-01T00:00:00.000Z',
        is_read: true,
      },
    ],
    [{ cnt: 0 }],
  );
  assert.equal(out.items[0].id, 42);
  assert.equal(out.items[0].related_id, 7);
  assert.equal(out.items[0].is_read, true);
  assert.equal(out.items[0].created_at, '2026-06-01T00:00:00.000Z');
  assert.equal(out.unread_count, 0);
});
