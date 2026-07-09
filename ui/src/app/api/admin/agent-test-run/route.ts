// ui/src/app/api/admin/agent-test-run/route.ts
// 调 Agent /api/admin/test-run, full tool + LLM loop, 不存 DB。

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { callAgent } from '@/lib/agent-config-proxy';

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.role || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const result = await callAgent('/api/admin/test-run', {
    method: 'POST',
    headers: { 'x-wdg-user-id': user.user_id },
    body: JSON.stringify(body),
  });
  if (result.detail && result.status === 0) {
    return NextResponse.json(
      { success: false, error: 'agent_unreachable', detail: result.detail },
      { status: 503 },
    );
  }
  return NextResponse.json(result.body ?? {}, { status: result.status || 200 });
}
