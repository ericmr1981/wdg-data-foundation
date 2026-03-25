import { cookies } from 'next/headers';
import pool from '@/lib/db';

export type UserRole = 'admin' | 'operator';
export type SessionUser = { user_id: string; username: string; role: UserRole };

const COOKIE_NAME = 'wdg_session';

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const res = await pool.query(
    `
    SELECT u.user_id::text, u.username, u.role
    FROM ops.sessions s
    JOIN ops.users u ON u.user_id = s.user_id
    WHERE s.token = $1
      AND s.expires_at > NOW()
      AND u.enabled = TRUE
    LIMIT 1
    `,
    [token]
  );

  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export function assertRole(user: SessionUser | null, allowed: UserRole[]) {
  if (!user) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (!allowed.includes(user.role)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
}

export function getCookieName() {
  return COOKIE_NAME;
}
