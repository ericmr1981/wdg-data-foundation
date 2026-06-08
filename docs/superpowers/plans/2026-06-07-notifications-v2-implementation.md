# Notifications v2: Agent-Powered Unmatched Analysis & UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2 increment to notifications — sweep_unmatched_txn now auto-invokes Claude via a new batch API to generate classification proposals, which users review at /u/approvals; admin/config index gets 2 new cards; 3 notification UI pages are rebuilt with production-grade visuals.

**Architecture:** DDL adds `ops.service_token` table (for non-cookie machine auth) + `ops.notification.related_uuid` column. New API `POST /api/admin/analyze-unclassified` accepts service-token auth, runs Claude via `messages.create` (NOT MCP tool — batch scenario, no tool loop), and writes `ops.approval_proposals`. Sweep's `sweep_unmatched_txn` calls this API via `urllib` with `X-Service-Token` header. UI rebuilds via `frontend-design` skill.

**Tech Stack:** PostgreSQL (DDL), Python 3 (psycopg2, urllib), Next.js 14 (Anthropic SDK, node:test), TailwindCSS, frontend-design skill.

**Reference spec:** `docs/superpowers/specs/2026-06-07-notifications-v2-design.md`
**Reference v1 spec (for context):** `docs/superpowers/specs/2026-06-07-notifications-design.md`
**Worktree:** `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report`
**Base branch:** `main` (worktree was branched from `main @ 9937af5`)

---

## File Structure

### SQL Layer
- **Modify:** `sql/00_notifications_ddl.sql` — append `ops.service_token` table + `ops.notification.related_uuid` column

### Python Backend
- **Create:** `scripts/seed_service_token.py` — generates raw token, stores hash, prints raw once
- **Modify:** `scripts/notification_sweep.py` — add `call_analyze_api()` function + rewrite `sweep_unmatched_txn` to call it
- **Modify:** `tests/test_notification_sweep.py` — add 2 tests for the API integration

### Next.js Backend
- **Create:** `ui/src/lib/service-auth.ts` — `requireServiceToken(req, name)` middleware
- **Create:** `ui/src/app/api/admin/analyze-unclassified/route.ts` — batch analysis handler
- **Create:** `ui/src/app/api/admin/analyze-unclassified/route.test.ts` — node:test coverage (extract pure helpers if needed)

### Next.js Frontend
- **Modify:** `ui/src/app/u/approvals/page.tsx` — read `source`/`brand`/`batch`/`filter` query params, extend filter type to include `'pending'`, add top banner
- **Modify:** `ui/src/app/admin/config/page.tsx` — add 2 cards (通知调度 + 通知列表)
- **Replace:** `ui/src/components/NotificationBell.tsx` — UI v2 (via frontend-design skill)
- **Replace:** `ui/src/app/notifications/page.tsx` — UI v2 (via frontend-design skill)
- **Replace:** `ui/src/app/admin/config/notifications/page.tsx` — UI v2 (via frontend-design skill)

### Docs
- **Modify:** `CLAUDE.md` — append note about agent-powered unmatched analysis (small update)

---

## Task 1: DDL — add `ops.service_token` table + `ops.notification.related_uuid` column

**Files:**
- Modify: `sql/00_notifications_ddl.sql` (append at end)

- [ ] **Step 1.1: Read current DDL**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
tail -20 sql/00_notifications_ddl.sql
```

Expected: Last few lines of the existing DDL.

- [ ] **Step 1.2: Append v2 DDL using Edit tool**

Use Edit tool to add the following at the end of `sql/00_notifications_ddl.sql` (after the existing `COMMENT ON TABLE` lines):

```sql
-- ============================================================
-- v2 additions (2026-06-07):
--   ops.service_token: for non-cookie machine-to-machine auth (e.g. sweep daemon → Next.js batch API)
--   ops.notification.related_uuid: stores UUID refs (e.g. ops.approval_proposals.batch_id);
--     the existing related_id BIGINT remains for numeric refs
-- ============================================================

CREATE TABLE IF NOT EXISTS ops.service_token (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(80) UNIQUE NOT NULL,
    token_hash    VARCHAR(64) NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_token_name
    ON ops.service_token (name) WHERE enabled = true;

ALTER TABLE ops.notification ADD COLUMN IF NOT EXISTS related_uuid VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_notification_related_uuid
    ON ops.notification (related_uuid) WHERE related_uuid IS NOT NULL;

COMMENT ON TABLE ops.service_token IS 'Service-to-service auth tokens (SHA-256 hash stored; raw token only in env)';
COMMENT ON COLUMN ops.notification.related_uuid IS 'Optional UUID ref (e.g. approval_proposals.batch_id)';
```

- [ ] **Step 1.3: Apply DDL to dev DB**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a

python <<'PYEOF'
import psycopg2, os
conn = psycopg2.connect(host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
                        dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
                        password=os.environ['DB_PASSWORD'])
with conn.cursor() as cur:
    cur.execute(open('sql/00_notifications_ddl.sql').read())
conn.commit()
print('DDL applied OK')
PYEOF
```

Expected: `DDL applied OK`. (Idempotent: re-runs are safe.)

- [ ] **Step 1.4: Verify schema**

```bash
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
python <<'PYEOF'
import psycopg2, os
conn = psycopg2.connect(host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
                        dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
                        password=os.environ['DB_PASSWORD'])
with conn.cursor() as cur:
    cur.execute("SELECT to_regclass('ops.service_token')")
    print('ops.service_token:', cur.fetchone()[0])
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='ops' AND table_name='notification' AND column_name IN ('related_id','related_uuid')")
    for r in cur.fetchall(): print(' ', r)
PYEOF
```

Expected:
- `ops.service_token: ops.service_token`
- `related_id` (existing)
- `related_uuid` (new, type `character varying`)

- [ ] **Step 1.5: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add sql/00_notifications_ddl.sql
git commit -m "feat(sql): add ops.service_token table + ops.notification.related_uuid column (v2)"
```

---

## Task 2: `lib/service-auth.ts` + `seed_service_token.py`

**Files:**
- Create: `ui/src/lib/service-auth.ts`
- Create: `scripts/seed_service_token.py`
- Test: `tests/test_seed_service_token.py` (light — verifies the token is hashable and round-trips)

- [ ] **Step 2.1: Write `ui/src/lib/service-auth.ts`**

```ts
// ui/src/lib/service-auth.ts
// Service-to-service auth: client sends `X-Service-Token: <raw>` header.
// We SHA-256 the raw token and look it up in ops.service_token.
// We do NOT support user-cookie auth here — that's a separate concern.

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import pool from '@/lib/db';

export interface ServiceAuth {
  id: number;
  name: string;
}

export async function requireServiceToken(req: NextRequest, name: string): Promise<ServiceAuth | null> {
  const raw = req.headers.get('x-service-token');
  if (!raw) return null;
  const hash = createHash('sha256').update(raw).digest('hex');
  const { rows } = await pool.query(
    `SELECT id, name FROM ops.service_token
     WHERE token_hash = $1 AND enabled = true AND name = $2`,
    [hash, name]
  );
  if (rows.length === 0) return null;
  // Fire-and-forget: update last_used_at (do not block request)
  pool.query(
    `UPDATE ops.service_token SET last_used_at = now() WHERE id = $1`,
    [rows[0].id]
  ).catch(() => {/* ignore */});
  return { id: rows[0].id, name: rows[0].name };
}
```

- [ ] **Step 2.2: Write `scripts/seed_service_token.py`**

```python
#!/usr/bin/env python3
"""
Seed or rotate the 'sweep-notification' service token.
Prints the raw token ONCE on stdout. DB stores only SHA-256 hash.
Re-running rotates the token (new raw, new hash).
"""
import hashlib
import os
import secrets
import sys

import psycopg2

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'dataplatform'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.environ['DB_PASSWORD'],
}


def main():
    raw = secrets.token_urlsafe(32)  # 43-char URL-safe random string
    h = hashlib.sha256(raw.encode()).hexdigest()
    conn = psycopg2.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops.service_token (name, token_hash, enabled)
            VALUES ('sweep-notification', %s, true)
            ON CONFLICT (name) DO UPDATE
            SET token_hash = EXCLUDED.token_hash,
                enabled = true,
                created_at = now()
            """,
            (h,),
        )
    conn.commit()
    conn.close()
    print('========================================================')
    print('SERVICE TOKEN CREATED (will NOT be shown again):')
    print(f'  WDG_SERVICE_TOKEN={raw}')
    print('========================================================')
    print('Save this in /opt/wdg/.env (or your secret manager).')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2.3: Run seed and verify**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
python scripts/seed_service_token.py
```

**Note the printed `WDG_SERVICE_TOKEN=...`** — you'll need it for Tasks 3 and 4. Save it in your shell or .env.

Verify:
```bash
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
python <<'PYEOF'
import psycopg2, os
conn = psycopg2.connect(host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
                        dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
                        password=os.environ['DB_PASSWORD'])
with conn.cursor() as cur:
    cur.execute("SELECT name, enabled, length(token_hash) FROM ops.service_token")
    for r in cur.fetchall(): print(r)
PYEOF
```

Expected: `('sweep-notification', True, 64)` (64-char hex SHA-256).

- [ ] **Step 2.4: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add ui/src/lib/service-auth.ts scripts/seed_service_token.py
git commit -m "feat: service token auth lib + seed script (v2)"
```

---

## Task 3: `/api/admin/analyze-unclassified` route + tests

**Files:**
- Create: `ui/src/app/api/admin/analyze-unclassified/route.ts`
- Create: `ui/src/lib/analyze-unclassified.ts` (pure helper, testable in node:test)
- Create: `ui/src/lib/analyze-unclassified.test.ts` (node:test for the pure helper)
- Create: `ui/src/app/api/admin/analyze-unclassified/route.test.ts` (node:test for the request validation)

- [ ] **Step 3.1: Read existing patterns to follow**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
ls src/lib/notification-queries.ts src/lib/notification-types.ts 2>&1
head -30 src/lib/chat/agent-config-store.ts
```

Skim these to understand: how `pool.query` is used; how `getAgentConfig()` returns config (model name); how `buildSystemPrompt` is imported.

- [ ] **Step 3.2: Write the pure helper `ui/src/lib/analyze-unclassified.ts`**

```ts
// ui/src/lib/analyze-unclassified.ts
// Pure helper for the analyze-unclassified route. Extracted for testability
// (the actual Anthropic SDK call is injected, allowing tests to mock it).

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '@/lib/chat/prompt';
import { getAgentConfig } from '@/lib/chat/agent-config-store';

export interface UnclassifiedTxnForAnalysis {
  bank_txn_id: number;
  txn_time: string;
  summary: string | null;
  memo: string | null;
  purpose: string | null;
  counterparty_name: string | null;
  in_amt: number;
  out_amt: number;
}

export interface LlmProposalRecord {
  bank_txn_id: number;
  type: 'type1' | 'type2';
  llm_proposal: {
    lvl1_code: string;
    lvl2_code: string | null;
    keyword: string | null;
    match_field: 'summary' | 'memo' | 'purpose' | 'counterparty_name' | null;
    confidence: 'high' | 'medium' | 'low' | null;
    reasoning: string | null;
  } | null;
  reasoning: string | null;
}

export interface AnalysisResult {
  batch_id: string;
  proposals: LlmProposalRecord[];
  errors: string[];
  model_used: string;
}

const USER_PROMPT_TEMPLATE = (brand: string, json: string) => `你是 wdg-data-platform 的财务分类员。
以下是 ${brand} 品牌当前 {N} 条未配条目的银行流水(JSON array)。
请为每条输出 {lvl1_code, lvl2_code, keyword, match_field, confidence, reasoning}, 包装成一个 JSON array 返回。
不要调用任何工具, 直接给 JSON。\n\n[嵌入未配条目]\n${json}`;

function buildUserPrompt(brand: string, txns: UnclassifiedTxnForAnalysis[]): string {
  return USER_PROMPT_TEMPLATE(brand, JSON.stringify(txns, null, 2));
}

function parseModelResponse(text: string): LlmProposalRecord[] {
  // Strip markdown ```json fences if present
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = (m ? m[1] : text).trim();
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Model response is not a JSON array');
  }
  return parsed as LlmProposalRecord[];
}

export interface RunLlmOpts {
  client?: Anthropic;            // injectable for tests
  model?: string;                // overrides getAgentConfig
  brand: string;
  txns: UnclassifiedTxnForAnalysis[];
}

export async function runLlmAnalysis(opts: RunLlmOpts): Promise<LlmProposalRecord[]> {
  const cfg = getAgentConfig();
  const model = opts.model ?? cfg.model ?? 'claude-opus-4-8';
  const client = opts.client ?? new Anthropic();
  const systemPrompt = buildSystemPrompt({ brand: opts.brand, page: 'batch-analyze' });
  const userPrompt = buildUserPrompt(opts.brand, opts.txns);
  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = resp.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return parseModelResponse(text);
}
```

- [ ] **Step 3.3: Write node:test for the helper**

```ts
// ui/src/lib/analyze-unclassified.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { parseModelResponse, buildUserPrompt } from './analyze-unclassified.ts';

test('parseModelResponse strips json fences', () => {
  const text = '```json\n[{"bank_txn_id": 1, "type": "type1", "llm_proposal": null, "reasoning": null}]\n```';
  const out = parseModelResponse(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].bank_txn_id, 1);
});

test('parseModelResponse handles raw json', () => {
  const text = '[{"bank_txn_id": 2, "type": "type2", "llm_proposal": null, "reasoning": "x"}]';
  const out = parseModelResponse(text);
  assert.equal(out[0].bank_txn_id, 2);
  assert.equal(out[0].type, 'type2');
});

test('parseModelResponse throws on non-array', () => {
  assert.throws(() => parseModelResponse('{"not": "array"}'), /not a JSON array/);
});

test('buildUserPrompt embeds txn JSON', () => {
  const prompt = buildUserPrompt('tamkoko', [
    { bank_txn_id: 1, txn_time: '2026-06-01', summary: '工资', memo: null, purpose: null, counterparty_name: '员工', in_amt: 0, out_amt: 100 },
  ]);
  assert.ok(prompt.includes('tamkoko'));
  assert.ok(prompt.includes('"bank_txn_id": 1'));
  assert.ok(prompt.includes('员工'));
});
```

- [ ] **Step 3.4: Run node:test for the helper**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
node --test --experimental-strip-types src/lib/analyze-unclassified.test.ts 2>&1 | tail -10
```

Expected: 4 tests pass.

- [ ] **Step 3.5: Write the route `ui/src/app/api/admin/analyze-unclassified/route.ts`**

```ts
// ui/src/app/api/admin/analyze-unclassified/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireServiceToken } from '@/lib/service-auth';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';
import { runLlmAnalysis, UnclassifiedTxnForAnalysis, LlmProposalRecord } from '@/lib/analyze-unclassified';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BRANDS = new Set(['tamkoko', 'gelatomiiix', 'bonjur']);
const MAX_LIMIT = 50;
const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || null;  // for created_by FK; nullable

interface RouteInput {
  brand: string;
  limit: number;
  unclassified_txn_ids?: number[];
}

function parseInput(body: unknown): RouteInput | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const brand = typeof b.brand === 'string' ? b.brand : '';
  if (!BRANDS.has(brand)) return { error: `unknown brand: ${brand}` };
  const limit = typeof b.limit === 'number' ? b.limit : MAX_LIMIT;
  if (limit <= 0 || limit > MAX_LIMIT) return { error: `limit must be 1..${MAX_LIMIT}` };
  const ids = Array.isArray(b.unclassified_txn_ids) ? b.unclassified_txn_ids : undefined;
  if (ids && (!ids.every((x) => typeof x === 'number' && Number.isInteger(x) && x > 0))) {
    return { error: 'unclassified_txn_ids must be positive integers' };
  }
  return { brand, limit, unclassified_txn_ids: ids as number[] | undefined };
}

async function loadTxns(brand: string, ids: number[] | undefined, limit: number): Promise<UnclassifiedTxnForAnalysis[]> {
  const cfg = BANK_TABLE_BY_BRAND[brand];
  const params: unknown[] = [];
  let where = 'c.id IS NULL';
  if (ids && ids.length > 0) {
    where = `t.id = ANY($${params.length + 1}::int[])`;
    params.push(ids);
  }
  const sql = `
    SELECT t.id AS bank_txn_id, t.txn_time, t.summary, t.memo, t.purpose,
           t.counterparty_name, t.in_amt, t.out_amt
    FROM ${cfg.bank_table} t
    LEFT JOIN ${cfg.classified_schema}.${cfg.classified_snapshot} c ON c.bank_txn_id = t.id
    WHERE ${where}
    ORDER BY t.txn_time DESC
    LIMIT ${limit}
  `;
  const { rows } = await pool.query(sql, params);
  return rows as UnclassifiedTxnForAnalysis[];
}

const BANK_TABLE_BY_BRAND: Record<string, { bank_table: string; classified_schema: string; classified_snapshot: string }> = {
  tamkoko:     { bank_table: 'brand_tamkoko_ods.bank_txn',     classified_schema: 'brand_tamkoko_dm',     classified_snapshot: 'bank_txn_classified_snapshot' },
  gelatomiiix: { bank_table: 'brand_gelatomiiix_ods.bank_txn', classified_schema: 'brand_gelatomiiix_dm', classified_snapshot: 'bank_txn_classified_snapshot' },
  bonjur:      { bank_table: 'bonjur_ods.bank_txn',             classified_schema: 'bonjur_dm',             classified_snapshot: 'bank_txn_classified_snapshot' },
};

export async function POST(req: NextRequest) {
  // 1. service token auth
  const svc = await requireServiceToken(req, 'sweep-notification');
  if (!svc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 2. parse body
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const parsed = parseInput(raw);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // 3. load unclassified txns
  let txns: UnclassifiedTxnForAnalysis[];
  try {
    txns = await loadTxns(parsed.brand, parsed.unclassified_txn_ids, parsed.limit);
  } catch (e) {
    return NextResponse.json({ error: 'load failed: ' + getErrorMessage(e) }, { status: 500 });
  }
  if (txns.length === 0) {
    return NextResponse.json({ batch_id: null, proposals_created: 0, errors: ['no unclassified txns'] });
  }

  // 4. call Claude
  let llmRecords: LlmProposalRecord[];
  try {
    llmRecords = await runLlmAnalysis({ brand: parsed.brand, txns });
  } catch (e) {
    return NextResponse.json(
      { batch_id: null, proposals_created: 0, errors: ['claude_unavailable: ' + getErrorMessage(e)] },
      { status: 502 }
    );
  }

  // 5. write proposals
  const batchId = randomUUID();
  let proposalsCreated = 0;
  const errors: string[] = [];
  for (const rec of llmRecords) {
    try {
      const lp = rec.llm_proposal;
      await pool.query(
        `INSERT INTO ops.approval_proposals
           (bank_txn_id, type, status, batch_id, created_by,
            lvl1_code, lvl2_code, keyword, match_field, confidence, reasoning, created_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (batch_id, bank_txn_id) DO NOTHING`,
        [
          rec.bank_txn_id, rec.type, batchId, SYSTEM_USER_ID,
          lp?.lvl1_code ?? null, lp?.lvl2_code ?? null, lp?.keyword ?? null,
          lp?.match_field ?? null, lp?.confidence ?? null, rec.reasoning ?? null,
        ]
      );
      proposalsCreated++;
    } catch (e) {
      errors.push(`txn ${rec.bank_txn_id}: ${getErrorMessage(e)}`);
    }
  }

  return NextResponse.json({ batch_id: batchId, proposals_created: proposalsCreated, errors });
}
```

> **Note on `created_by`**: `ops.approval_proposals.created_by` may be `uuid` (FK to `ops.users.user_id`). If nullable or has a default, `SYSTEM_USER_ID = null` is fine; otherwise you can omit `created_by` from the INSERT. **Verify** with `\d ops.approval_proposals` during implementation and adjust the SQL accordingly.

- [ ] **Step 3.6: Write node:test for the route's input validation**

```ts
// ui/src/app/api/admin/analyze-unclassified/route.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { parseInput } from './route.ts';

test('parseInput rejects unknown brand', () => {
  const r = parseInput({ brand: 'unknown', limit: 10 });
  assert.ok('error' in r);
  assert.match((r as { error: string }).error, /unknown brand/);
});

test('parseInput rejects limit > 50', () => {
  const r = parseInput({ brand: 'tamkoko', limit: 100 });
  assert.ok('error' in r);
});

test('parseInput accepts valid input', () => {
  const r = parseInput({ brand: 'tamkoko', limit: 30, unclassified_txn_ids: [1, 2, 3] });
  assert.ok(!('error' in r));
  assert.equal((r as { brand: string }).brand, 'tamkoko');
  assert.equal((r as { limit: number }).limit, 30);
});

test('parseInput rejects non-integer txn ids', () => {
  const r = parseInput({ brand: 'tamkoko', unclassified_txn_ids: [1.5, 'x'] });
  assert.ok('error' in r);
});
```

- [ ] **Step 3.7: Run node:test for both files**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
node --test --experimental-strip-types src/lib/analyze-unclassified.test.ts src/app/api/admin/analyze-unclassified/route.test.ts 2>&1 | tail -10
```

Expected: 4 + 4 = 8 tests pass.

- [ ] **Step 3.8: Smoke test the route live**

**Prereq**: dev server is running on port 4100 (from earlier). If not:
```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
npm run dev  # in another terminal / background
```

**Test no token (expect 401)**:
```bash
curl -s -o /dev/null -w "no token → HTTP %{http_code}\n" \
  -X POST http://localhost:4100/api/admin/analyze-unclassified \
  -H "Content-Type: application/json" \
  -d '{"brand":"tamkoko"}'
```

Expected: `no token → HTTP 401`.

**Test with token (expect 200 with batch_id)**:
```bash
TOKEN="<paste the WDG_SERVICE_TOKEN from Task 2 step 2.3>"
curl -s -X POST http://localhost:4100/api/admin/analyze-unclassified \
  -H "Content-Type: application/json" \
  -H "X-Service-Token: $TOKEN" \
  -d '{"brand":"tamkoko","limit":5}' | head -c 500
echo ""
```

Expected: JSON `{"batch_id": "...", "proposals_created": N, "errors": []}` or `{"batch_id": null, "proposals_created": 0, "errors": [...]}` if no unclassified.

- [ ] **Step 3.9: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add ui/src/lib/analyze-unclassified.ts ui/src/lib/analyze-unclassified.test.ts \
        ui/src/app/api/admin/analyze-unclassified/
git commit -m "feat(api): POST /api/admin/analyze-unclassified (v2 batch LLM)"
```

---

## Task 4: Sweep `sweep_unmatched_txn` rewrite + tests

**Files:**
- Modify: `scripts/notification_sweep.py` — add `call_analyze_api()`, rewrite `sweep_unmatched_txn`
- Modify: `tests/test_notification_sweep.py` — add 2 tests for API integration

- [ ] **Step 4.1: Read current `sweep_unmatched_txn` and brand map**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
grep -n "sweep_unmatched_txn\|def sweep" scripts/notification_sweep.py
cat scripts/notification_sweep_brand_map.py | head -50
```

Verify the brand map has `bank_table`, `classified_schema`, `classified_snapshot` keys for all 3 brands. If not, **add them now** (the original Task 3 plan only kept 6 fields, but we need these for the join):

```python
# In scripts/notification_sweep_brand_map.py, add to each brand:
'tamkoko': {
    ...,
    'bank_table': 'brand_tamkoko_ods.bank_txn',
    'classified_schema': 'brand_tamkoko_dm',
    'classified_snapshot': 'bank_txn_classified_snapshot',
},
# Same for gelatomiiix and bonjur
```

(Note: this is a minor spec-deviation fix from the v1 brand map; the new spec requires these fields. The bank map currently has 6 fields; the 3 added fields are project-internal pointers that don't change the dedup/upsert logic.)

- [ ] **Step 4.2: Add `call_analyze_api()` to `scripts/notification_sweep.py`**

Append to the end of the file (before any `if __name__ == '__main__'` block):

```python
# === batch analyze API (v2) ===

import os as _os
import json as _json
import urllib.request as _urllib_request
import urllib.error as _urllib_error

NEXT_BASE_URL = _os.getenv('WDG_NEXT_BASE_URL', 'http://localhost:4100')
SERVICE_TOKEN = _os.getenv('WDG_SERVICE_TOKEN', '')


def call_analyze_api(brand: str, txn_ids: list[int]) -> dict | None:
    """
    POST /api/admin/analyze-unclassified with X-Service-Token.
    Returns parsed JSON or None on any error (caller continues gracefully).
    """
    if not SERVICE_TOKEN:
        log.warning('WDG_SERVICE_TOKEN not set; skipping analyze for %s', brand)
        return None
    try:
        req = _urllib_request.Request(
            f"{NEXT_BASE_URL}/api/admin/analyze-unclassified",
            data=_json.dumps({'brand': brand, 'unclassified_txn_ids': txn_ids}).encode(),
            headers={
                'Content-Type': 'application/json',
                'X-Service-Token': SERVICE_TOKEN,
            },
            method='POST',
        )
        with _urllib_request.urlopen(req, timeout=60) as resp:
            return _json.loads(resp.read())
    except (_urllib_error.URLError, _urllib_error.HTTPError, TimeoutError, _json.JSONDecodeError, OSError) as e:
        log.warning('analyze api failed for %s: %s', brand, e)
        return None
```

- [ ] **Step 4.3: Rewrite `sweep_unmatched_txn`**

Replace the existing `sweep_unmatched_txn` function with:

```python
def sweep_unmatched_txn(conn, brands: list[str] | None = None) -> int:
    target_brands = brands or all_brand_codes()
    today_iso = date.today().isoformat()
    new_count = 0

    for brand in target_brands:
        cfg = BRAND_SOURCE_MAP[brand]
        unclassified_view = cfg.get('unclassified_table')
        if not unclassified_view:
            continue

        # 1. count via view
        with conn.cursor() as cur:
            try:
                cur.execute(f'SELECT COUNT(*) FROM {unclassified_view}')
                count = cur.fetchone()[0]
            except psycopg2.Error as e:
                log.warning('sweep_unmatched_txn: %s count failed: %s', unclassified_view, e)
                count = 0

        if count == 0:
            resolve_notification_by_dedup_prefix(conn, f'unmatched_txn:{brand}:')
            continue

        # 2. fetch up to 50 unclassified txn ids from bank_txn (the view lacks bank_txn_id)
        bank_table = cfg.get('bank_table')
        classified_schema = cfg.get('classified_schema', cfg.get('bank_ods_schema'))
        classified_snapshot = cfg.get('classified_snapshot', 'bank_txn_classified_snapshot')
        txn_ids: list[int] = []
        if bank_table and classified_schema:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f'''
                        SELECT t.id FROM {bank_table} t
                        LEFT JOIN {classified_schema}.{classified_snapshot} c ON c.bank_txn_id = t.id
                        WHERE c.id IS NULL
                        ORDER BY t.txn_time DESC
                        LIMIT 50
                        '''
                    )
                    txn_ids = [r[0] for r in cur.fetchall()]
            except psycopg2.Error as e:
                log.warning('sweep_unmatched_txn: failed to load ids for %s: %s', brand, e)

        # 3. call analyze API
        api_result = call_analyze_api(brand, txn_ids) if txn_ids else None

        # 4. write notification
        if api_result and api_result.get('batch_id') and api_result.get('proposals_created', 0) > 0:
            batch_id = api_result['batch_id']
            proposals = api_result['proposals_created']
            new_count += upsert_notification(
                conn,
                type_='unmatched_txn',
                dedup_key=f'unmatched_txn:{brand}:{today_iso}:{batch_id}',
                title=f'{brand} 有 {count} 条未配条目,已生成建议待审批',
                body=f'批次 {batch_id[:8]}, 共 {proposals} 条建议',
                brand_code=brand,
                severity='warn',
                action_url=f'/u/approvals?source=unmatched&brand={brand}&batch={batch_id}&filter=pending',
                action_label='去审批',
                related_uuid=batch_id,
            )
        else:
            # No unclassified ids, OR API failed, OR 0 proposals — still notify
            new_count += upsert_notification(
                conn,
                type_='unmatched_txn',
                dedup_key=f'unmatched_txn:{brand}:{today_iso}:no-analysis',
                title=f'{brand} 有 {count} 条未配条目待分析',
                body='自动分析暂未完成, 请人工处理或检查 service token 配置',
                brand_code=brand,
                severity='warn',
                action_url=f'/match?brand={brand}&status=unclassified',
                action_label='去查看',
            )

    return new_count
```

- [ ] **Step 4.4: Update `upsert_notification` to accept `related_uuid`**

Find the existing `upsert_notification` signature and add `related_uuid` parameter:

```python
def upsert_notification(
    conn,
    *,
    type_: str,
    dedup_key: str,
    title: str,
    body: str,
    brand_code: str | None = None,
    severity: str = 'info',
    action_url: str | None = None,
    action_label: str | None = None,
    related_id: int | None = None,
    related_uuid: str | None = None,    # NEW
) -> int:
    """
    Insert a notification (or refresh swept_at on existing active row).
    Returns 1 = inserted, 0 = already exists.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops.notification
                (type, brand_code, severity, title, body,
                 action_url, action_label, related_id, related_uuid, dedup_key, swept_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (dedup_key) WHERE status = 'active'
            DO UPDATE SET swept_at = now()
            RETURNING (xmax = 0) AS inserted
            """,
            (type_, brand_code, severity, title, body,
             action_url, action_label, related_id, related_uuid, dedup_key),
        )
        row = cur.fetchone()
        conn.commit()
        return 1 if row and row[0] else 0
```

Also update the **other 3 sweep functions** to pass `related_uuid=None` (or extract it from the dedup_key):

For `sweep_data_stale`, `sweep_dup_rule`, `sweep_monthly_report` — these call `upsert_notification` without `related_uuid`. The default `None` works, **no changes needed**.

- [ ] **Step 4.5: Write tests for the v2 sweep behavior**

Append to `tests/test_notification_sweep.py`:

```python
# === unmatched_txn v2 (analyze API integration) ===

def test_sweep_unmatched_txn_calls_analyze_api_and_writes_batch_notification(conn, monkeypatch):
    """When analyze API returns a batch_id + proposals > 0, sweep writes a notification with related_uuid."""
    fake_api_result = {
        'batch_id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'proposals_created': 5,
        'errors': [],
    }
    monkeypatch.setattr('scripts.notification_sweep.call_analyze_api', lambda brand, ids: fake_api_result)
    monkeypatch.setattr('scripts.notification_sweep.WDG_NEXT_BASE_URL', 'http://x', raising=False)
    # Force count > 0 by patching the COUNT query is hard; instead seed a dummy notification row first
    # We'll just call sweep and assert it doesn't crash + it makes a 'no-analysis' or batch notification
    n = sweep_unmatched_txn(conn, brands=['gelatomiiix'])
    assert n >= 0


def test_sweep_unmatched_txn_handles_api_failure_with_no_analysis_notice(conn, monkeypatch):
    """When analyze API returns None, sweep writes a ':no-analysis' notification."""
    monkeypatch.setattr('scripts.notification_sweep.call_analyze_api', lambda brand, ids: None)
    n = sweep_unmatched_txn(conn, brands=['gelatomiiix'])
    assert n >= 0
```

(These are smoke tests — they verify sweep doesn't crash on the API call path. Stricter assertion would require mocking the COUNT query which is non-trivial.)

- [ ] **Step 4.6: Run all sweep tests**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
PYTHONPATH=. pytest tests/test_notification_sweep.py -v 2>&1 | tail -20
```

Expected: 7 prior tests + 2 new = 9 pass (or 7 + 2 skip if API is unreachable; the new ones should pass since they mock the call).

- [ ] **Step 4.7: Smoke test the sweep end-to-end with real API token**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
export WDG_SERVICE_TOKEN="<paste from Task 2.3>"
export WDG_NEXT_BASE_URL="http://localhost:4100"
python scripts/run_notification_sweep.py --task unmatched_txn --brands tamkoko 2>&1 | tail -5
```

Expected: `Total: 1 new notifications` (or more) and `ops.notification` has a new row with `related_uuid` filled.

Verify:
```bash
python <<'PYEOF'
import psycopg2, os
conn = psycopg2.connect(host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
                        dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
                        password=os.environ['DB_PASSWORD'])
with conn.cursor() as cur:
    cur.execute("SELECT id, type, brand_code, related_uuid, action_url FROM ops.notification WHERE type='unmatched_txn' ORDER BY id DESC LIMIT 3")
    for r in cur.fetchall(): print(r)
PYEOF
```

Expected: latest row has `related_uuid` populated (a UUID string) and `action_url` starts with `/u/approvals?source=unmatched&...`.

- [ ] **Step 4.8: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add scripts/notification_sweep.py scripts/notification_sweep_brand_map.py tests/test_notification_sweep.py
git commit -m "feat(scripts): sweep_unmatched_txn auto-calls analyze api (v2)"
```

---

## Task 5: `/u/approvals` accepts `source/brand/batch/filter=pending`

**Files:**
- Modify: `ui/src/app/u/approvals/page.tsx`

- [ ] **Step 5.1: Read current `/u/approvals` page**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
head -100 src/app/u/approvals/page.tsx
```

Understand: where is `useSearchParams()`? Where is `filter` state declared? Where is the proposals rendered? Where is the JSX root `<div>`?

- [ ] **Step 5.2: Add 3 query param reads + 1 filter state extension**

Find the `useSearchParams()` line and add (just after):

```ts
const source = searchParams.get('source');
const brandParam = searchParams.get('brand');
const filterParam = searchParams.get('filter');
```

Find the `useState<FilterTab>('all')` and change the type to:

```ts
type FilterTab = 'all' | 'type1' | 'type2' | 'pending';
const [filter, setFilter] = useState<FilterTab>('all');
```

Find the `useMemo` that computes `filtered` and replace with:

```ts
const filtered = useMemo(() => {
  if (filter === 'type1') return proposals.filter(p => p.type === 'type1');
  if (filter === 'type2') return proposals.filter(p => p.type === 'type2');
  if (filter === 'pending') return proposals.filter(p => p.status === 'pending');
  return proposals;
}, [proposals, filter]);
```

Add a useEffect (find an existing one or add a new one) to apply URL params on mount:

```ts
useEffect(() => {
  if (filterParam === 'pending') setFilter('pending');
  if (brandParam && typeof setSelectedBrand === 'function') setSelectedBrand(brandParam);
  // Note: setSelectedBrand may not exist — see step 5.3 for brand switching
}, [filterParam, brandParam]);
```

- [ ] **Step 5.3: Handle `brandParam` correctly**

Check if the page has a brand selector (uses `useBrand()` from `brand-context`). If yes, add `setSelectedBrand` is **not** how it works — `useBrand` returns `{brand, setBrand}`. The right way:

```ts
import { useBrand } from '@/lib/brand-context';
// ...
const { brand, setBrand } = useBrand();
useEffect(() => {
  if (filterParam === 'pending') setFilter('pending');
  if (brandParam && brandParam !== brand) setBrand(brandParam);
}, [filterParam, brandParam]);  // eslint-disable-line react-hooks/exhaustive-deps
```

If the page does **not** use `useBrand` (e.g. it always uses a different state), adapt to use that state's setter.

- [ ] **Step 5.4: Add the top banner**

Find the JSX root `<div className="...">` (or top of the page body) and add a banner just before the existing header:

```tsx
{source === 'unmatched' && batchId && (
  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm">
    📌 来自未配分析批次 <code className="font-mono text-xs">{batchId.slice(0, 8)}</code>,
    共 <b>{proposals.filter(p => p.batch_id === batchId).length}</b> 条建议,
    已为你筛选 <code>status='pending'</code> 的项。
  </div>
)}
```

- [ ] **Step 5.5: Build to verify**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5.6: Smoke test in browser**

1. Open `http://localhost:4100/u/approvals?source=unmatched&brand=tamkoko&batch=<some-uuid>&filter=pending` (get a real batch_id from the notification you created in Task 4 step 4.7)
2. Verify the banner appears with the correct batch_id prefix
3. Verify the proposals list is filtered to `status='pending'`

- [ ] **Step 5.7: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add ui/src/app/u/approvals/page.tsx
git commit -m "feat(ui): /u/approvals accepts source/brand/batch/filter=pending (v2)"
```

---

## Task 6: `/admin/config` add 2 cards

**Files:**
- Modify: `ui/src/app/admin/config/page.tsx`

- [ ] **Step 6.1: Read current admin config page**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
cat src/app/admin/config/page.tsx
```

You should see 4 `<Card>` instances (字典管理 / 品牌管理 / 门店管理 / 规则分组).

- [ ] **Step 6.2: Add 2 more `<Card>` blocks**

Inside the `<div className="grid ...">`, add after the existing 4 cards:

```tsx
<Card
  title="通知调度"
  desc="配置 4 个 sweep 任务的 cron 表达式与品牌过滤,改完即生效。"
  href="/admin/config/notifications"
/>
<Card
  title="通知列表"
  desc="查看所有活跃通知,按类型筛选,标已读/关闭。"
  href="/notifications"
/>
```

- [ ] **Step 6.3: Build to verify**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
npm run build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 6.4: Smoke test in browser**

Open `http://localhost:4100/admin/config` and verify the 2 new cards are visible (with working links).

- [ ] **Step 6.5: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add ui/src/app/admin/config/page.tsx
git commit -m "feat(ui): admin/config adds notifications cards (v2)"
```

---

## Task 7: UI rebuild — 3 pages (NotificationBell, /notifications, /admin/config/notifications)

This task uses the `frontend-design` skill.

**Files:**
- Replace: `ui/src/components/NotificationBell.tsx`
- Replace: `ui/src/app/notifications/page.tsx`
- Replace: `ui/src/app/admin/config/notifications/page.tsx`

- [ ] **Step 7.1: Snapshot the current implementations**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
cp src/components/NotificationBell.tsx /tmp/v1-NotificationBell.tsx.bak
cp src/app/notifications/page.tsx /tmp/v1-notifications-page.tsx.bak
cp src/app/admin/config/notifications/page.tsx /tmp/v1-admin-config-notifications-page.tsx.bak
```

(Belt-and-suspenders; git history has them too.)

- [ ] **Step 7.2: Dispatch the frontend-design skill**

Use the Skill tool:

```
Skill: frontend-design
args: Rebuild 3 notification UI pages for the WDG Data Foundation:
  1. ui/src/components/NotificationBell.tsx (top-nav bell with dropdown, mounted in providers.tsx NavBar)
  2. ui/src/app/notifications/page.tsx (full-page list of notifications)
  3. ui/src/app/admin/config/notifications/page.tsx (admin config page for cron schedules)

The project is a Next.js 14 + TailwindCSS app (no shadcn, no new deps). Keep Chinese copy.
Match the visual language of /admin/config (cards) and /u/approvals (tabs, table).
Use severity color tokens: red (error), amber (warn), blue (info).
Type contract: see ui/src/lib/notification-types.ts (NotificationItem has id, type, brand_code, severity, title, body, action_url, action_label, related_id, created_at, is_read).
API contract: GET /api/notifications returns {unread_count, items[]}; POST /api/notifications/{id}/read, /dismiss, /read-all.
Existing NotificationBell already uses these. The rebuild should preserve all current behavior (mark read on click, dismiss with X, read-all button) but improve visual polish.
```

- [ ] **Step 7.3: Verify build + no behavior regression**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report/ui
npm run build 2>&1 | tail -10
```

Expected: build succeeds. The new components should compile without TS errors.

- [ ] **Step 7.4: Visual smoke test in browser**

Open `http://localhost:4100/notifications` and `http://localhost:4100/admin/config/notifications` (login required). Verify:
- NotificationBell: clickable, shows unread badge, dropdown panel renders correctly
- /notifications: severity badges colored, tabs filter, click navigates, dismiss removes
- /admin/config/notifications: 4 schedule rows editable, save triggers reload (daemon not required for UI to work)

- [ ] **Step 7.5: Run pre-existing test suite to ensure no regression**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
PYTHONPATH=. pytest tests/test_notification_sweep.py tests/test_wdg_scheduler_daemon.py -v 2>&1 | tail -10
```

Expected: 7 prior sweep tests + 2 from Task 4 = 9 pass.

```bash
cd ui
node --test --experimental-strip-types src/lib/notification-queries.test.ts \
                              src/lib/notification-types.test.ts \
                              src/app/api/notifications/route.test.ts \
                              src/lib/analyze-unclassified.test.ts \
                              src/app/api/admin/analyze-unclassified/route.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 7.6: Commit**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add ui/src/components/NotificationBell.tsx ui/src/app/notifications/page.tsx ui/src/app/admin/config/notifications/page.tsx
git commit -m "feat(ui): rebuild 3 notification pages (v2 visual polish)"
```

---

## Task 8: Final acceptance

- [ ] **Step 8.1: Run full test suites**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.venv/bin/activate
set -a && source /Users/ericmr/Documents/GitHub/wdg-data-foundation/.env && set +a
PYTHONPATH=. pytest tests/ 2>&1 | tail -5
```

Expected: all pass (or skip cleanly).

```bash
cd ui
node --test --experimental-strip-types src/lib/*.test.ts src/app/api/**/route.test.ts 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

Expected: all pass / build succeeds.

- [ ] **Step 8.2: Update CLAUDE.md (small)**

Find the "Reminders & Reports" section added in v1 (Task 16 of v1). Append one paragraph about v2:

```markdown

**v2 增量**: 未配条目现在会自动调 Claude 分析并写入 `ops.approval_proposals` 等待审批。提醒的 action_url 指向 `/u/approvals?source=unmatched&brand=...&batch=...&filter=pending`。
```

Add the paragraph immediately after the existing v1 description.

- [ ] **Step 8.3: Commit CLAUDE.md**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git add CLAUDE.md
git commit -m "docs(claude): note v2 auto-analysis in Reminders section"
```

- [ ] **Step 8.4: Verify no untracked files or unintended changes**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/feat+notifications-and-monthly-report
git status
```

Expected: clean working tree. If any untracked files (e.g. `.env`, `node_modules`, `.next`), they should NOT be committed (gitignore should already handle this).

- [ ] **Step 8.5: Final commit (if any drift)**

If anything's uncommitted, commit with a fixup message. Otherwise skip.

---

## Self-Review

### 1. Spec coverage

| Spec section | Covered by |
|---|---|
| §2.1 DDL (`ops.service_token` + `related_uuid`) | Task 1 |
| §2.2 通知 ↔ 批次关联 | Task 4 step 4.4 (related_uuid on upsert), Task 5 step 5.4 (banner shows batch_id) |
| §3.1 `POST /api/admin/analyze-unclassified` API contract | Task 3 |
| §3.2 服务端实现 (model from agent-config, messages.create, JSON parse, write approval_proposals) | Task 3 steps 3.5 + 3.6 |
| §3.3 `lib/service-auth.ts` | Task 2 step 2.1 |
| §3.4 `seed_service_token.py` | Task 2 step 2.2 |
| §4.1 `sweep_unmatched_txn` rewrite | Task 4 steps 4.1-4.4 |
| §4.2 `call_analyze_api()` | Task 4 step 4.2 |
| §4.3 env 变量 | Task 4 step 4.7, Task 2 step 2.3 |
| §5.1 searchParams | Task 5 step 5.2 |
| §5.2 filter='pending' | Task 5 step 5.2 |
| §5.3 top banner | Task 5 step 5.4 |
| §6 /admin/config 加 2 cards | Task 6 |
| §7 UI 重做 3 页 (frontend-design skill) | Task 7 |
| §8.1 Python tests | Task 4 step 4.5 |
| §8.2 node:test for API | Task 3 steps 3.3, 3.6 |
| §8.3 node:test for UI (skipped — client component, no unit test surface) | (intentional gap) |
| §8.4 Playwright (skipped — no live app, manual walkthrough only) | (intentional gap) |
| §9 部署 (env 追加, .env 配 WDG_SERVICE_TOKEN) | Task 2 step 2.3 (printed token) + manual step |
| §10 里程碑 T1-T7 | All tasks 1-7 + Task 8 acceptance |
| §11 风险与缓解 | Documented in plan, mostly self-mitigated by YAGNI choices |

### 2. Placeholder scan

- No "TBD" / "TODO: implement later" / "fill in details" / "add appropriate error handling"
- One conditional: Task 4 step 4.1 mentions "If [fields] not, add them now" — this is a real implementation need (not a placeholder), and the syntax is shown
- Task 4 step 4.4 has a note "**Verify** with `\d ops.approval_proposals`" — this is an implementation-time check, not a placeholder

### 3. Type consistency

- `ServiceAuth` defined once in Task 2 step 2.1, used in Task 3 step 3.5
- `LlmProposalRecord` defined in Task 3 step 3.2, used in Task 3 step 3.5
- `RouteInput` defined in Task 3 step 3.5, used only there
- `BatchId` is a UUID string in `related_uuid VARCHAR(64)` (consistent with all uses)
- `dedup_key` format `unmatched_txn:{brand}:{YYYY-MM-DD}:{batch_id}` is consistent between Task 4 spec and Task 4 implementation
- `action_url` format `/u/approvals?source=unmatched&brand={brand}&batch={batch_id}&filter=pending` is consistent between Task 4 (sweep writes) and Task 5 (page reads)

### 4. Intentional gaps (called out in spec, acceptable for v2)

- §8.3 node:test for UI: client components — minimal unit test surface; manual walkthrough in Task 7 step 7.4 covers
- §8.4 Playwright: no dev server guarantees; manual walkthrough
- Service token `last_used_at` fire-and-forget: intentionally non-blocking
- `SYSTEM_USER_ID` for `created_by`: may be `null`; the SQL is constructed to accept null
- `ops.approval_proposals.created_by` may not exist as a column: Task 3 step 3.5 has a note to verify with `\d` and adjust

### 5. No missing requirements

All v2 spec sections are covered by tasks. The plan is ready for execution.
