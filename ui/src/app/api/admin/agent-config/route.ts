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
    /**
     * 新增:外部 MCP backend 的 raw Bearer tokens(明文)。
     * 只在内存中存在,Agent 端会用 AGENT_CRED_ENCRYPTION_KEY 加密后入库。
     * '__DELETE__' 哨兵 = 删除该 backend 的加密 token。
     * 不在 body 中 = 保留 DB 现存 token。 */
    mcpBackendTokens?: Record<string, string>;
  };

  // 适配 UI form 字段 → Agent 期望的 credentials 嵌套
  const agentBody: Record<string, unknown> = {}
  if (typeof body.agentMd === 'string') agentBody.agentMd = body.agentMd
  if (body.params && typeof body.params === 'object') agentBody.params = body.params
  if (body.baseURL !== undefined || body.apiKey !== undefined || body.model !== undefined) {
    const credentials: Record<string, unknown> = {}
    // 约定:表单“留空” = 保留 DB 原值,不显式清空。
    // UI 刷新页面后这些字段都是空串,如果按老逻辑全转 null,会覆盖 DB。
    if ('baseURL' in body) {
      if (typeof body.baseURL === 'string' && body.baseURL.trim()) {
        credentials.baseURL = body.baseURL.trim()
      }
    }
    if ('apiKey' in body) {
      if (typeof body.apiKey === 'string' && body.apiKey !== '') {
        credentials.apiKey = body.apiKey
      }
    }
    if ('model' in body) {
      credentials.model = (typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : 'claude-opus-4-8'
    }
    // 只在至少有一个有意义的 credentials 字段时才发 agentBody.credentials
    // 否则不发 (相当于“表单没动这部分”)
    if (Object.keys(credentials).length > 0) {
      agentBody.credentials = credentials
    }
  }
  if (typeof body.jwksUrl !== 'undefined') {
    // 空串 → 保留 DB 原值;非空字符串才发
    if (typeof body.jwksUrl === 'string' && body.jwksUrl.trim()) {
      agentBody.jwksUrl = body.jwksUrl.trim()
    }
  }
  if (Array.isArray(body.mcpBackends)) {
    // 防御:UI 提交时再剥一次 Authorization,确保绝不进 Agent
    for (const b of body.mcpBackends) {
      if (b.headers) {
        const cleaned: Record<string, string> = {}
        for (const [k, v] of Object.entries(b.headers)) {
          if (k.toLowerCase() !== 'authorization') cleaned[k] = v
        }
        b.headers = cleaned
      }
    }
    agentBody.mcpBackends = body.mcpBackends
  }
  if (body.mcpBackendTokens && Object.keys(body.mcpBackendTokens).length > 0) {
    agentBody.mcpBackendTokens = body.mcpBackendTokens
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
