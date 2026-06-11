// ui/src/app/api/admin/agent-config/route.ts
// v1: 改为 5 行 fetch 代理, 实际配置存在 Agent 进程
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

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

async function proxy(req: NextRequest, method: 'GET' | 'POST' | 'DELETE') {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = method === 'GET' ? undefined : await req.text()
  const r = await fetch(`${AGENT_URL}/api/admin/config`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-wdg-user-id': user.user_id,
      'x-wdg-user-role': user.role,
    },
    body,
  })
  return NextResponse.json(await r.json())
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

async function saveCredToDb(
  baseURL: string | null,
  apiKey: string | null,
  model: string,
  userId: string,
): Promise<{ persistedToDb: boolean }> {
  const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
  // If encryption key is unset, skip DB persistence — credentials still go
  // into the in-memory store, so the chat will use them this session.
  // Process restart → lose them (in-memory only). Admin gets a console warning
  // and the POST response should reflect that.
  if (!encKey) {
    console.warn(
      '[admin/agent-config] AGENT_CRED_ENCRYPTION_KEY unset — credentials will be in-memory only (lost on process restart). Set the env var to persist across restarts.',
    );
    return { persistedToDb: false };
  }
  const encryptedKey = apiKey ? encrypt(apiKey, encKey) : null;
  await pool.query(
    `INSERT INTO ops.chat_agent_credentials (id, base_url, encrypted_api_key, model, updated_by)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       model = EXCLUDED.model,
       updated_by = EXCLUDED.updated_by`,
    [baseURL, encryptedKey, model, userId],
  );
  return { persistedToDb: true };
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
  return NextResponse.json({
    agentMd: cfg.agentMd,
    params,
    defaultParams: DEFAULT_PARAMS,
    baseURL: fromDb?.baseURL ?? cfg.baseURL ?? null,
    apiKeyMasked: maskKey(fromDb?.apiKey ?? cfg.apiKey),
    model: fromDb?.model ?? cfg.model,
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
      console.warn(
        '[agent-config] writeFileSync failed; in-memory update only:',
        err,
      );
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
  if (
    body.baseURL !== undefined ||
    body.apiKey !== undefined ||
    body.model !== undefined
  ) {
    const currentFromDb = await loadCredFromDb();
    const newBaseURL =
      body.baseURL !== undefined
        ? typeof body.baseURL === 'string' && body.baseURL.trim()
          ? body.baseURL.trim()
          : null // explicit null/empty => clear
        : (currentFromDb?.baseURL ?? null);

    let newApiKey: string | null;
    if (typeof body.apiKey === 'string') {
      if (body.apiKey === '') {
        newApiKey = null; // explicit clear
      } else {
        newApiKey = body.apiKey; // update
      }
    } else {
      newApiKey = currentFromDb?.apiKey ?? null; // unchanged
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
  // Also clear DB credentials row
  try {
    await pool.query(
      `UPDATE ops.chat_agent_credentials
         SET base_url = NULL,
             encrypted_api_key = NULL,
             model = $1,
             updated_by = $2
       WHERE id = 1`,
      [DEFAULT_MODEL, user.user_id],
    );
  } catch (err) {
    console.warn(
      '[admin/agent-config] DB clear on reset failed:',
      (err as Error).message,
    );
  }
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}
