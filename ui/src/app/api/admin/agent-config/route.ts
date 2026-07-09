// ui/src/app/api/admin/agent-config/route.ts
// Phase 2 增量 (started, partial):
//   - 加 callAgentConfig() helper: GET/POST Agent /api/admin/config
//   - GET 现在额外读 Agent 的 config 状态并合并到响应 (admin UI 可看 Agent source)
//   - POST 还在原地 (未做双写 — 后续 phase 2.5 完成后)
// 后续计划:
//   POST 改成: 写完 UI 自己 store 后, 同步调 Agent /api/admin/config。
//   Agent 不可达 → 报错并回滚 UI store。详见 docs/phase-2-plan.md

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { getSessionUser } from '@/lib/auth-server';
import pool from '@/lib/db';
import {
  getAgentConfig,
  setAgentMd,
  setParams,
  setCredentialConfig,
  resetAgentConfig,
  applyConfigToGlobals,
  persistConfigToDb,
  hydrateConfigFromDb,
  AGENT_MD_FILE_PATH,
  DEFAULT_PARAMS,
} from '@/lib/chat/agent-config-store';
import { encrypt, decrypt, SecretCryptoError } from '@/lib/chat/secret-crypto';

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

// Phase 2 helper — 调 Agent /api/admin/config。返回 {ok, data | error}。
// 失败(连接/超时/5xx)返回 ok=false, 不抛异常; UI 路由决定如何呈现。
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

async function loadCredFromDb() {
  const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
  if (!encKey) return null;
  try {
    const { rows } = await pool.query(
      'SELECT base_url, encrypted_api_key, model, params FROM ops.chat_agent_credentials WHERE id = 1',
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      baseURL: (row.base_url as string | null) ?? null,
      apiKey: row.encrypted_api_key
        ? decrypt(row.encrypted_api_key as string, encKey)
        : null,
      model: (row.model as string) || DEFAULT_MODEL,
      params: (row.params as Record<string, unknown> | null) ?? null,
    };
  } catch (err) {
    console.warn('[admin/agent-config] DB load failed, falling back to in-memory store:', (err as Error).message);
    return null;
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Hydrate in-memory store from DB first (handles process restart / HMR)
  await hydrateConfigFromDb(pool);
  const cfg = getAgentConfig();
  const fromDb = await loadCredFromDb();
  // Merge DB params if available (they take precedence over in-memory defaults)
  let params = { ...cfg.params };
  if (fromDb?.params) {
    for (const [k, v] of Object.entries(fromDb.params)) {
      if (k in params && typeof v === typeof (params as any)[k]) {
        (params as any)[k] = v;
      }
    }
  }
  // Phase 2: 同时读 Agent 自己的 config 显示给 UI (read-only, 不阻塞)
  const agentGet = await callAgentConfig('GET')
  const agentState = agentGet.ok
    ? ((agentGet.data as Record<string, unknown>)?.source ?? null)
    : `unreachable: ${agentGet.error ?? agentGet.status}`

  return NextResponse.json({
    agentMd: cfg.agentMd,
    params,
    defaultParams: DEFAULT_PARAMS,
    baseURL: fromDb?.baseURL ?? cfg.baseURL ?? null,
    apiKeyMasked: maskKey(fromDb?.apiKey ?? cfg.apiKey),
    model: fromDb?.model ?? cfg.model,
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

  // Credentials: handle baseURL / apiKey / model updates with partial semantics.
  if (body.baseURL !== undefined || body.apiKey !== undefined || body.model !== undefined) {
    const currentFromDb = await loadCredFromDb();
    const newBaseURL =
      body.baseURL !== undefined
        ? typeof body.baseURL === 'string' && body.baseURL.trim()
          ? body.baseURL.trim()
          : null
        : (currentFromDb?.baseURL ?? null);

    let newApiKey: string | null;
    if (typeof body.apiKey === 'string') {
      if (body.apiKey === '') {
        newApiKey = null;
      } else {
        newApiKey = body.apiKey;
      }
    } else {
      newApiKey = currentFromDb?.apiKey ?? null;
    }

    const newModel =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : currentFromDb?.model ?? DEFAULT_MODEL;

    setCredentialConfig(newBaseURL, newApiKey, newModel);
  }

  // Persist all config (params + creds) to DB
  await persistConfigToDb(pool, user.user_id);

  applyConfigToGlobals();

  return NextResponse.json({ success: true, config: getAgentConfig() });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!isAdmin(user) || !user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  resetAgentConfig();
  try {
    await pool.query(
      `UPDATE ops.chat_agent_credentials SET base_url = NULL, encrypted_api_key = NULL, model = $1, updated_by = $2 WHERE id = 1`,
      [DEFAULT_MODEL, user.user_id],
    );
  } catch (err) {
    console.warn('[admin/agent-config] DB clear on reset failed:', (err as Error).message);
  }
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}
