// ui/src/app/api/admin/agent-test-chat/route.ts
// UI 端点: 接 admin 提交, 转发到 Agent /api/admin/test-chat。

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { callAgent } from '@/lib/agent-config-proxy';

function isAdmin(user: any): boolean {
  return user?.role === 'admin';
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const result = await callAgent('/api/admin/test-chat', {
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
