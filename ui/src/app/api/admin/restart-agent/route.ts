// ui/src/app/api/admin/restart-agent/route.ts
// POST → Agent /api/admin/restart (触发 systemd restart)

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { callAgent } from '@/lib/agent-config-proxy';

export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await callAgent('/api/admin/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  // Agent 重启后会立即退出，可能返回 fetch failed / status 0，
  // 这都是正常行为——只要调用发出去了就行。
  if (result.detail && result.status === 0) {
    return NextResponse.json({ success: true, message: 'restart triggered (agent is restarting)' });
  }
  if (result.status === 202) {
    return NextResponse.json({ success: true, message: 'restarting...' });
  }
  return NextResponse.json(result.body ?? {}, { status: result.status || 200 });
}
