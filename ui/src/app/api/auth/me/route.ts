import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ success: true, data: user });
}
