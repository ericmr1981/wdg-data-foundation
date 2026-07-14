// ui/src/app/api/admin/mcp-status/route.ts
// 代理 agent /api/admin/mcp-status

import { NextResponse } from 'next/server';

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://127.0.0.1:4101';

export const dynamic = 'force-dynamic';

export async function GET() {
  const r = await fetch(`${AGENT_URL}/api/admin/mcp-status`, {
    headers: { 'x-wdg-user-role': 'admin' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await r.json();
  return NextResponse.json(body, { status: r.status });
}
