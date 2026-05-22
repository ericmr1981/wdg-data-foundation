import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCookieName } from '@/lib/auth-server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getCookieName())?.value;

  try {
    if (token) {
      await pool.query('DELETE FROM ops.sessions WHERE token=$1', [token]);
    }
  } catch (err) {
    // best-effort
    console.error('logout error', err);
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set({ name: getCookieName(), value: '', httpOnly: true, path: '/', expires: new Date(0) });
  return res;
}
