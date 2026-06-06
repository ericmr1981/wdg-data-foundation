// ui/src/app/api/admin/agent-config/route.ts
// Spec §4.2: GET/POST/DELETE /api/admin/agent-config
// - GET: returns current agent.md + params + defaults
// - POST: updates agent.md and/or params; persists agent.md to disk (best effort)
// - DELETE: resets to defaults
// Admin-only. All three handlers call applyConfigToGlobals() so updates take
// effect on the next request without restarting the dev server.

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { getSessionUser } from '@/lib/auth-server';
import {
  getAgentConfig,
  setAgentMd,
  setParams,
  resetAgentConfig,
  applyConfigToGlobals,
  AGENT_MD_FILE_PATH,
  DEFAULT_PARAMS,
} from '@/lib/chat/agent-config-store';

export const runtime = 'nodejs';

const VALID_KEYS = new Set(Object.keys(DEFAULT_PARAMS));

function isAdmin(user: { role: string } | null): boolean {
  return user?.role === 'admin';
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const cfg = getAgentConfig();
  return NextResponse.json({
    agentMd: cfg.agentMd,
    params: cfg.params,
    defaultParams: DEFAULT_PARAMS,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    agentMd?: unknown;
    params?: Record<string, unknown>;
  };

  if (typeof body.agentMd === 'string') {
    setAgentMd(body.agentMd);
    try {
      writeFileSync(AGENT_MD_FILE_PATH, body.agentMd, 'utf-8');
    } catch (err) {
      // File write failed (permissions, read-only FS, etc.) — in-memory update
      // still applied. Surface a console warning for visibility.
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

  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  resetAgentConfig();
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}
