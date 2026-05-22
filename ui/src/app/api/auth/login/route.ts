import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCookieName } from '@/lib/auth-server';
import crypto from 'crypto';

const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 5;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const ip = request.headers.get('x-forwarded-for')
      ?.split(',')[0].trim()
      ?? 'unknown';

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Missing username/password' }, { status: 400 });
    }

    // ── Rate limit check (同一 IP 最近5分钟失败次数) ──
    const rateCheck = await pool.query(`
      SELECT COUNT(*)::int as attempt_count
      FROM ops.login_attempts
      WHERE ip_address = $1::inet
        AND success = false
        AND attempted_at > NOW() - ($2 || ' minutes')::interval
    `, [ip, String(LOCKOUT_WINDOW_MINUTES)]);

    const attemptCount = rateCheck.rows[0].attempt_count;
    if (attemptCount >= MAX_ATTEMPTS) {
      const retryAfter = LOCKOUT_WINDOW_MINUTES * 60;
      return NextResponse.json(
        { success: false, error: 'Too many failed attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    // ── Password verification ──
    const userRes = await pool.query(
      `
      SELECT user_id::text, username, role, enabled
      FROM ops.users
      WHERE username = $1
        AND password_hash = crypt($2, password_hash)
      LIMIT 1
      `,
      [username, password]
    );

    const user = userRes.rows[0];
    const isSuccess = !!user;

    // ── Record attempt ──
    await pool.query(
      `
      INSERT INTO ops.login_attempts (ip_address, username, success, user_id)
      VALUES ($1::inet, $2, $3, $4::uuid)
      `,
      [ip, username, isSuccess, user?.user_id ?? null]
    );

    if (!isSuccess) {
      // 用户不存在也记录，但不泄露"用户名不存在"（防用户枚举）
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    if (!user.enabled) {
      return NextResponse.json({ success: false, error: 'Account disabled' }, { status: 403 });
    }

    // ── Create session ──
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    await pool.query(
      `
      INSERT INTO ops.sessions (token, user_id, expires_at)
      VALUES ($1, $2::uuid, $3)
      `,
      [token, user.user_id, expiresAt]
    );

    const res = NextResponse.json({ success: true, data: { user: { user_id: user.user_id, username: user.username, role: user.role } } });
    res.cookies.set({
      name: getCookieName(),
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    return res;
  } catch (err: any) {
    console.error('login error', err);
    return NextResponse.json({ success: false, error: 'Login failed' }, { status: 500 });
  }
}
