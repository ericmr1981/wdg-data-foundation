// ui/src/app/api/chat/context/route.ts
// Task 9: updates the current user's chat session context.
// Two modes:
//   { reset: true }        → clears messages + context
//   { context: {...} }     → merges context (preserves unset fields)

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { getOrCreateSession, updateSession, resetSession } from '@/lib/chat/session-store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sess = getOrCreateSession(user.user_id);
  if (body.reset === true) {
    resetSession(sess.id);
    return NextResponse.json({ sessionId: sess.id, context: {}, messages: [] });
  }
  const ctx = (body.context ?? {}) as Record<string, string | undefined>;
  updateSession(sess.id, {
    context: {
      brand:  ctx.brand  ?? sess.context.brand,
      store:  ctx.store  ?? sess.context.store,
      period: ctx.period ?? sess.context.period,
      page:   ctx.page   ?? sess.context.page,
    },
  });
  return NextResponse.json({ sessionId: sess.id, context: sess.context });
}
