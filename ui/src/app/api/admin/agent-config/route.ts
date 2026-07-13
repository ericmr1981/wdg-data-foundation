// ui/src/app/api/admin/agent-config/route.ts
// Phase 5: 整个路由变成 Agent /api/admin/config 的 thin proxy。
// UI 端不再持有自己的 LLM 配置存储 — 所有配置直接转发给 Agent (Phase 1)。
// Agent 是 source of truth (agent.config DB 表 + Agent in-memory)。

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { callAgent, callAgentJson, AGENT_ERROR_STATUS } from '@/lib/agent-config-proxy';

function isAdmin(user: any): boolean {
  return user?.role === 'admin';
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const view = await callAgentJson('GET');
  return NextResponse.json(view);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    agentMd?: string;
    params?: Record<string, unknown>;
    baseURL?: string | null;
    apiKey?: string | null;
    model?: string;
    jwksUrl?: string | null;
    mcpBackends?: Array<{ name: string; url: string; transport?: string; headers?: Record<string,string>; timeoutMs?: number }>;
  };

  // 适配 UI form 字段 → Agent 期望的 credentials 嵌套
  const agentBody: Record<string, unknown> = {}
  if (typeof body.agentMd === 'string') agentBody.agentMd = body.agentMd
  if (body.params && typeof body.params === 'object') agentBody.params = body.params
  if (body.baseURL !== undefined || body.apiKey !== undefined || body.model !== undefined) {
    const credentials: Record<string, unknown> = {}
    if ('baseURL' in body) {
      credentials.baseURL = body.baseURL
        ? (typeof body.baseURL === 'string' && body.baseURL.trim() ? body.baseURL.trim() : null)
        : null
    }
    if ('apiKey' in body) {
      credentials.apiKey = (typeof body.apiKey === 'string' && body.apiKey !== '') ? body.apiKey : null
    }
    if ('model' in body) {
      credentials.model = (typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : 'claude-opus-4-8'
    }
    agentBody.credentials = credentials
  }
  if (typeof body.jwksUrl !== 'undefined') {
    agentBody.jwksUrl = (typeof body.jwksUrl === 'string' && body.jwksUrl.trim()) ? body.jwksUrl.trim() : null
  }
  if (Array.isArray(body.mcpBackends)) {
    agentBody.mcpBackends = body.mcpBackends
  }

  const result = await callAgent('/api/admin/config', {
    method: 'POST',
    headers: { 'x-wdg-user-id': user.user_id },
    body: JSON.stringify(agentBody),
  });
  if (result.detail && result.status === 0) {
    return NextResponse.json(
      { error: 'agent unreachable', detail: result.detail },
      { status: 503 },
    );
  }
  return NextResponse.json(result.body ?? {}, { status: result.status || 200 });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Agent 自己的 /api/admin/config/reset — 清 agentMd/params/creds 全部到 DEFAULT
  const result = await callAgent('/api/admin/config/reset', { method: 'POST' });
  if (result.detail && result.status === 0) {
    return NextResponse.json(
      { error: 'agent unreachable', detail: result.detail },
      { status: 503 },
    );
  }
  if (result.status >= 200 && result.status < 300) {
    return NextResponse.json({ success: true, ...(result.body as object ?? {}) });
  }
  return NextResponse.json(result.body ?? {}, { status: result.status });
}
