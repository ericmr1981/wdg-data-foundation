// ui/src/app/api/admin/agent-config/route.ts
// Spec §4.2: GET/POST/DELETE /api/admin/agent-config
// - GET: returns current agent.md + params + baseURL + masked apiKey + model + defaults
// - POST: updates any subset of {agentMd, params, baseURL, apiKey, model};
//         agentMd persisted to disk (best effort); credentials persisted to DB encrypted.
// - DELETE: resets to defaults (including clearing DB credentials row).
// Admin-only. All three handlers call applyConfigToGlobals() so updates take
// effect on the next request without restarting the dev server.

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
  AGENT_MD_FILE_PATH,
  DEFAULT_PARAMS,
} from '@/lib/chat/agent-config-store';
import { encrypt, decrypt, SecretCryptoError } from '@/lib/chat/secret-crypto';

export const runtime = 'nodejs';

const VALID_KEYS = new Set(Object.keys(DEFAULT_PARAMS));
const DEFAULT_MODEL = 'claude-opus-4-8';

function isAdmin(user: { role: string } | null): boolean {
  return user?.role === 'admin';
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
      'SELECT base_url, encrypted_api_key, model FROM ops.chat_agent_credentials WHERE id = 1',
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      baseURL: (row.base_url as string | null) ?? null,
      apiKey: row.encrypted_api_key
        ? decrypt(row.encrypted_api_key as string, encKey)
        : null,
      model: (row.model as string) || DEFAULT_MODEL,
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
) {
  const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
  if (!encKey) {
    throw new Error('AGENT_CRED_ENCRYPTION_KEY env not set; cannot encrypt credentials');
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
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const cfg = getAgentConfig();
  const fromDb = await loadCredFromDb();
  return NextResponse.json({
    agentMd: cfg.agentMd,
    params: cfg.params,
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

    await saveCredToDb(newBaseURL, newApiKey, newModel, user.user_id);
    setCredentialConfig(newBaseURL, newApiKey, newModel);
  }

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
