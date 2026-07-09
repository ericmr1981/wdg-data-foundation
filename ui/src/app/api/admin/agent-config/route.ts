// ui/src/app/api/admin/agent-config/route.ts
// Phase 4: 简化
// - 删 ops.chat_agent_credentials 引用 (表已删)
// - agent-config-store 的 persist/hydrate 已经是 no-op
// - GET 仍然调 Agent /api/admin/config 拉 source 状态给 admin UI 显示
// - POST 仍然只更新 UI 端 in-memory;真正的 key 配置走 Agent 端

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { getSessionUser } from '@/lib/auth-server';
import {
  getAgentConfig,
  setAgentMd,
  setParams,
  setCredentialConfig,
  resetAgentConfig,
  applyConfigToGlobals,
  AGENT_MD_FILE_PATH,
  DEFAULT_PARAMS,
} from '@/lib/chat/agent-config-store';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';

function isAdmin(user: any): boolean {
  return user?.role === 'admin';
}

const VALID_KEYS = new Set([
  'maxTokens', 'temperature', 'topP', 'maxToolChainDepth',
  'rateLimitMaxPerMinute', 'tokenSoftLimit', 'tokenHardLimit',
  'mcpRetryMaxAttempts', 'thinkingLevel',
]);

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101';

// Phase 2 保留:调 Agent /api/admin/config。失败返回 ok=false 不抛异常。
async function callAgentConfig(
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
  timeoutMs = 3000,
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${AGENT_URL}/api/admin/config`, {
      method,
      headers: {
        'x-wdg-user-role': 'admin',
        'content-type': 'application/json',
        ...(method === 'POST' && body ? { 'x-wdg-user-id': 'ui-admin' } : {}),
      },
      body: method === 'POST' && body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    let data: unknown = null
    try { data = await res.json() } catch { /* body may be empty */ }
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

function maskKey(k: string | null): string | null {
  if (!k) return null;
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '***' + k.slice(-4);
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const cfg = getAgentConfig();
  // Phase 2 保留:Agent 端的 source 显示给 admin (Agent 是真正 key 持有者)
  const agentGet = await callAgentConfig('GET')
  const agentState = agentGet.ok
    ? ((agentGet.data as Record<string, unknown>)?.source ?? null)
    : `unreachable: ${agentGet.error ?? agentGet.status}`

  return NextResponse.json({
    agentMd: cfg.agentMd,
    params: cfg.params,
    defaultParams: DEFAULT_PARAMS,
    baseURL: cfg.baseURL,
    apiKeyMasked: maskKey(cfg.apiKey),
    model: cfg.model,
    agent: {
      reachable: agentGet.ok,
      source: agentState,
      hasApiKey: (agentGet.data as Record<string, unknown>)?.hasApiKey ?? null,
      model: (agentGet.data as Record<string, unknown>)?.model ?? null,
      baseUrl: (agentGet.data as Record<string, unknown>)?.baseUrl ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    agentMd?: unknown;
    params?: Record<string, unknown>;
    baseURL?: unknown;
    apiKey?: unknown;
    model?: unknown;
  };

  if (typeof body.agentMd === 'string') {
    setAgentMd(body.agentMd);
    try {
      writeFileSync(AGENT_MD_FILE_PATH, body.agentMd, 'utf-8');
    } catch (err) {
      console.warn('[agent-config] writeFileSync failed; in-memory update only:', err);
    }
  }

  if (body.params && typeof body.params === 'object') {
    const validated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.params)) {
      if (!VALID_KEYS.has(k)) continue;
      validated[k] = v;
    }
    setParams(validated as Partial<Parameters<typeof setParams>[0]>);
  }

  // Phase 4: 这里只更新 UI in-memory store。真正的 credentials 配置
  // 走 Agent (在 Agent admin UI /api/admin/config 那边写 agent.config 表)
  if (body.baseURL !== undefined || body.apiKey !== undefined || body.model !== undefined) {
    const newBaseURL =
      body.baseURL !== undefined
        ? typeof body.baseURL === 'string' && body.baseURL.trim()
          ? body.baseURL.trim()
          : null
        : null
    let newApiKey: string | null
    if (typeof body.apiKey === 'string') {
      newApiKey = body.apiKey === '' ? null : body.apiKey
    } else {
      newApiKey = null  // 不从 DB 拉了
    }
    const newModel =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL

    setCredentialConfig(newBaseURL, newApiKey, newModel)
  }

  applyConfigToGlobals()
  return NextResponse.json({ success: true, config: getAgentConfig() })
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  resetAgentConfig()
  applyConfigToGlobals()
  return NextResponse.json({ success: true, config: getAgentConfig() })
}
