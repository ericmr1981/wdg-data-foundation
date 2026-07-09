// ui/src/app/api/admin/agent-config/route.ts
// Phase 5: 整个路由变成 Agent /api/admin/config 的 thin proxy。
// UI 端不再持有自己的 LLM 配置存储 — 所有配置直接转发给 Agent (Phase 1)。
// Agent 是 source of truth (agent.config DB 表 + Agent in-memory)。

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';

function isAdmin(user: any): boolean {
  return user?.role === 'admin';
}

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101';

// helper: 转给 Agent,带 admin 鉴权 header + 3s 超时
async function callAgent(
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown; detail?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  let r: Response | null = null
  try {
    r = await fetch(`${AGENT_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'x-wdg-user-role': 'admin',
        'content-type': 'application/json',
      },
      signal: ctrl.signal,
    })
  } catch (e) {
    return { status: 0, body: null, detail: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  try { body = await r.json() } catch { /* non-JSON body */ }
  return { status: r.status, body }
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const res = await callAgent('/api/admin/config', { method: 'GET' })
  if (res.detail && res.status === 0) {
    // network / abort error — agent 无法连通
    return NextResponse.json(
      { error: 'agent unreachable', detail: res.detail },
      { status: 503 },
    )
  }
  const body = (res.body ?? {}) as Record<string, unknown>
  return NextResponse.json({
    agentMd: body.agentMdContent ?? '',
    params: body.params ?? {},
    defaultParams: body.defaultParams ?? {},
    baseURL: body.baseUrl ?? null,
    apiKeyMasked: body.hasApiKey ? '***' : null,
    model: body.model ?? 'claude-opus-4-8',
    agent: {
      reachable: res.status >= 200 && res.status < 300,
      source: body.source ?? null,
      hasApiKey: body.hasApiKey ?? null,
      model: body.model ?? null,
      baseUrl: body.baseUrl ?? null,
    },
  })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    agentMd?: string
    params?: Record<string, unknown>
    baseURL?: string | null
    apiKey?: string | null
    model?: string
  }

  // Phase 5: 把 UI 提交的全部转给 Agent。Agent 端对应字段:
  //   agentMd       → Agent in-memory (写文件 + in-memory)
  //   params        → Agent in-memory + DB (JSONB)
  //   credentials   → Agent in-memory + DB (加密)
  // UI 端的 user.user_id 作为 updated_by 透传给 Agent
  const agentBody: Record<string, unknown> = {}
  if (typeof body.agentMd === 'string') agentBody.agentMd = body.agentMd
  if (body.params && typeof body.params === 'object') agentBody.params = body.params
  if (body.baseURL !== undefined || body.apiKey !== undefined || body.model !== undefined) {
    agentBody.credentials = {}
    if (body.baseURL !== undefined) {
      ;(agentBody.credentials as Record<string, unknown>).baseURL =
        typeof body.baseURL === 'string' && body.baseURL.trim() ? body.baseURL.trim() : null
    }
    if (body.apiKey !== undefined) {
      ;(agentBody.credentials as Record<string, unknown>).apiKey =
        body.apiKey === '' ? null : body.apiKey
    }
    if (body.model !== undefined) {
      ;(agentBody.credentials as Record<string, unknown>).model = body.model || 'claude-opus-4-8'
    }
  }

  const res = await callAgent('/api/admin/config', {
    method: 'POST',
    headers: { 'x-wdg-user-id': user.user_id },
    body: JSON.stringify(agentBody),
  })
  if (res.detail && res.status === 0) {
    return NextResponse.json(
      { error: 'agent unreachable', detail: res.detail },
      { status: 503 },
    )
  }
  return NextResponse.json(res.body ?? {}, { status: res.status })
}

export async function DELETE() {
  const user = await getSessionUser()
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // Phase 5: 重置 = Agent 自己的 /api/admin/config/reset
  const res = await callAgent('/api/admin/config/reset', { method: 'POST' })
  if (res.detail && res.status === 0) {
    return NextResponse.json(
      { error: 'agent unreachable', detail: res.detail },
      { status: 503 },
    )
  }
  if (res.status >= 200 && res.status < 300) {
    return NextResponse.json({ success: true, ...(res.body ?? {}) })
  }
  return NextResponse.json(res.body ?? {}, { status: res.status })
}
