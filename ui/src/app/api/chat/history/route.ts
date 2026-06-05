// ui/src/app/api/chat/history/route.ts
// Task 9: returns the current user's chat session (id, context, messages)
// so the ChatWidget can restore state on mount.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { getOrCreateSession } from '@/lib/chat/session-store';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sess = getOrCreateSession(user.user_id);
  return NextResponse.json({
    sessionId: sess.id,
    context:   sess.context,
    messages:  sess.messages,
  });
}
