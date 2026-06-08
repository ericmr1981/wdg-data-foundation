import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    assertRole(user, ['admin']);
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const res = await fetch('http://127.0.0.1:4711/reload', { method: 'POST' });
    if (!res.ok) {
      return NextResponse.json({ error: `daemon returned ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) + ' (is wdg-scheduler running?)' }, { status: 503 });
  }
}
