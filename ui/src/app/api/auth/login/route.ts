import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCookieName } from '@/lib/auth-server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Missing username/password' }, { status: 400 });
    }

    // Verify password using pgcrypto crypt()
    const userRes = await pool.query(
      `
      SELECT user_id::text, username, role
      FROM ops.users
      WHERE username = $1
        AND enabled = TRUE
        AND password_hash = crypt($2, password_hash)
      LIMIT 1
      `,
      [username, password]
    );

    if (userRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    const user = userRes.rows[0];

    const token = crypto.randomUUID();
    // 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    await pool.query(
      `
      INSERT INTO ops.sessions (token, user_id, expires_at)
      VALUES ($1, $2::uuid, $3)
      `,
      [token, user.user_id, expiresAt]
    );

    const res = NextResponse.json({ success: true, data: { user } });
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
