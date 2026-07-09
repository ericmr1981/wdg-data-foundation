// ui/src/lib/agent-config-proxy.ts
// Server-side helper to call Agent /api/admin/config.
// 抽到这里供 page.tsx SSR 和 api/admin/agent-config/route.ts 共享,
// 避免 page.tsx 自调 /api/admin/agent-config (SSR self-fetch 模式在 Next.js 里不稳定)。

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101';

export const AGENT_ERROR_STATUS = 0;

export interface AgentCallResult {
  status: number;
  body: unknown;
  detail?: string;
}

export interface AgentConfigView {
  agentMd: string;
  params: Record<string, unknown>;
  defaultParams: Record<string, unknown>;
  baseURL: string | null;
  apiKeyMasked: string | null;
  model: string;
  agent: {
    reachable: boolean;
    source: string | null;
    hasApiKey: boolean | null;
    model: string | null;
    baseUrl: string | null;
  };
}

/** Generic Agent HTTP call (POST/GET/DELETE). 不解析 body。 */
export async function callAgent(
  path: string,
  init: RequestInit,
  timeoutMs = 120000,
): Promise<AgentCallResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r: Response | null = null;
  try {
    r = await fetch(`${AGENT_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'x-wdg-user-role': 'admin',
        'content-type': 'application/json',
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    return { status: AGENT_ERROR_STATUS, body: null, detail: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try { body = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, body };
}

/**
 * GET /api/admin/config 的 typed 入口 — 把 Agent 原始字段映射成
 * UI 那边 ClientAgentConfig 期待的 AgentConfigView 形状。
 */
export async function callAgentJson(method: 'GET'): Promise<AgentConfigView> {
  const r = await callAgent('/api/admin/config', { method });
  if (r.detail && r.status === AGENT_ERROR_STATUS) {
    return {
      agentMd: '',
      params: {},
      defaultParams: {},
      baseURL: null,
      apiKeyMasked: null,
      model: 'claude-opus-4-8',
      agent: { reachable: false, source: null, hasApiKey: null, model: null, baseUrl: null },
    };
  }
  const body = (r.body ?? {}) as Record<string, unknown>;
  const hasApiKey = (body.hasApiKey as boolean | undefined) ?? false;
  const reachable = r.status >= 200 && r.status < 300;
  return {
    agentMd: (body.agentMdContent as string | undefined) ?? '',
    params: (body.params as Record<string, unknown> | undefined) ?? {},
    defaultParams: (body.defaultParams as Record<string, unknown> | undefined) ?? {},
    baseURL: (body.baseUrl as string | null | undefined) ?? null,
    apiKeyMasked: hasApiKey ? '***' : null,
    model: (body.model as string | undefined) ?? 'claude-opus-4-8',
    agent: {
      reachable,
      source: (body.source as string | null | undefined) ?? null,
      hasApiKey,
      model: (body.model as string | null | undefined) ?? null,
      baseUrl: (body.baseUrl as string | null | undefined) ?? null,
    },
  };
}

/** SSR-friendly — page.tsx 直接 import,跳过内部 HTTP 路由。 */
export async function fetchAgentConfig(): Promise<AgentConfigView> {
  return callAgentJson('GET');
}
