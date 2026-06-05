# AI 聊天助手实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Next.js UI 中新增右下角悬浮 AI 聊天窗，后端用 Claude Opus 4.8 自主调用现有 45 个 MCP 工具取数生成回答。

**Architecture:** 在 `POST /api/mcp` 之上加一个新 SSE 端点 `POST /api/chat`，跑 Anthropic SDK 工具循环，把 `tool_use` 翻译成 JSON-RPC 调 `POST /api/mcp`。前端一个 `ChatWidget` 组件 + PageContext React Context 同步 `brand/store/period/page`。

**Tech Stack:** Next.js 14 (App Router), TypeScript, React 18, `@anthropic-ai/sdk` (NEW dep), Zod, SSE, vitest, msw, pytest, pg.

---

## 项目结构（按文件分组，任务按依赖顺序）

```
sql/                                  # DDL
  00_chat_audit_ddl.sql              # NEW

ui/src/lib/chat/                      # 业务逻辑（无 UI 依赖）
  prompt.ts                          # NEW — buildSystemPrompt
  auth.ts                            # NEW — filterToolsByRole
  mcp-bridge.ts                      # NEW — toolUse → JSON-RPC
  tools-schema.ts                    # NEW — 从 mcp registry 拿 zod schemas
  stream.ts                          # NEW — SSE 编解码
  session-store.ts                   # NEW — 内存 Map<sessionId, messages>

ui/src/mcp/
  server.ts                          # MODIFY — 导出 listToolSchemas()（给 chat 用）

ui/src/app/api/chat/                  # API
  route.ts                           # NEW — POST SSE 端点
  history/route.ts                   # NEW — GET 历史
  context/route.ts                   # NEW — POST 上下文差量

ui/src/components/chat/               # UI
  PageContext.tsx                    # NEW — React Context + Provider
  ChatWidget.tsx                     # NEW — 悬浮窗
  MessageList.tsx                    # NEW
  ChatInput.tsx                      # NEW
  types.ts                           # NEW

ui/src/app/u/
  layout.tsx                         # NEW — 注入 PageContext + 挂 ChatWidget
  page.tsx                           # MODIFY — children wrap（如有需要）

ui/.env.example                      # MODIFY — 加 ANTHROPIC_API_KEY

ui/package.json                      # MODIFY — 新增 @anthropic-ai/sdk
ui/vitest.config.ts                  # NEW（若不存在）

ui/tests/chat/                       # vitest
  prompt.test.ts                     # NEW
  auth.test.ts                       # NEW
  mcp-bridge.test.ts                 # NEW
  sse.test.ts                        # NEW

tests/test_chat_ddl.py              # NEW — pytest
```

---

## Task 1: 审计 DDL

**Files:**
- Create: `sql/00_chat_audit_ddl.sql`
- Create: `tests/test_chat_ddl.py`

- [ ] **Step 1: 写 DDL 文件**

```sql
-- sql/00_chat_audit_ddl.sql
-- AI chat widget audit tables. Per spec §9.

CREATE TABLE IF NOT EXISTS ops.chat_session_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT        NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  message_count   INT         NOT NULL DEFAULT 0,
  tool_call_count INT         NOT NULL DEFAULT 0,
  input_tokens    INT         NOT NULL DEFAULT 0,
  output_tokens   INT         NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,4) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ops.chat_tool_call (
  id                  BIGSERIAL PRIMARY KEY,
  session_id          BIGINT       NOT NULL REFERENCES ops.chat_session_log(id) ON DELETE CASCADE,
  tool_name           TEXT         NOT NULL,
  tool_input          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  tool_result_summary TEXT,
  is_error            BOOLEAN      NOT NULL DEFAULT FALSE,
  duration_ms         INT,
  called_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_tool_call_session ON ops.chat_tool_call(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_log_user  ON ops.chat_session_log(user_id);
```

- [ ] **Step 2: 写 pytest**

```python
# tests/test_chat_ddl.py
import os
import psycopg2
import pytest

@pytest.fixture(scope="module")
def db_conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set; skip live DDL test")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    yield conn
    conn.close()

def test_chat_session_log_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='ops' AND table_name='chat_session_log'
            ORDER BY ordinal_position
        """)
        cols = [r[0] for r in cur.fetchall()]
    assert cols == ['id', 'user_id', 'started_at', 'ended_at',
                    'message_count', 'tool_call_count',
                    'input_tokens', 'output_tokens', 'cost_usd']

def test_chat_tool_call_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='ops' AND table_name='chat_tool_call'
            ORDER BY ordinal_position
        """)
        cols = [r[0] for r in cur.fetchall()]
    assert cols == ['id', 'session_id', 'tool_name', 'tool_input',
                    'tool_result_summary', 'is_error', 'duration_ms', 'called_at']

def test_chat_tool_call_fk(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema='ops' AND table_name='chat_tool_call'
              AND constraint_type='FOREIGN KEY'
        """)
        assert cur.fetchone() is not None
```

- [ ] **Step 3: 应用 DDL 到本地 DB 并跑测试**

```bash
psql "$DATABASE_URL" -f sql/00_chat_audit_ddl.sql
pytest tests/test_chat_ddl.py -v
```

Expected: DDL 执行成功（`CREATE TABLE` / `CREATE INDEX`），3 个测试全过。

- [ ] **Step 4: Commit**

```bash
git add sql/00_chat_audit_ddl.sql tests/test_chat_ddl.py
git commit -m "feat(chat): add ops.chat_session_log + ops.chat_tool_call DDL"
```

---

## Task 2: 暴露工具 schema 注册表

**Files:**
- Modify: `ui/src/mcp/server.ts` (末尾加导出)

- [ ] **Step 1: 加导出**

在 `ui/src/mcp/server.ts` 末尾（最后 `}` 之后）追加：

```ts
// ui/src/mcp/server.ts (追加)
/**
 * Public schema snapshot for the chat adapter. Re-uses the live tool
 * registry so changes to TOOLS propagate without code edits.
 * Returns Anthropic-compatible tool definitions (name + description +
 * input_schema in JSON Schema form).
 */
export function listToolSchemas(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return Object.values(TOOLS).map(t => ({
    name: t.name,
    description: t.description,
    // Zod → JSON Schema.  We re-use the zod instance; for the chat
    // adapter a best-effort description is enough (the MCP dispatcher
    // re-validates server-side).
    input_schema: zodToJsonSchemaSafe(t.inputSchema),
  }));
}

function zodToJsonSchemaSafe(schema: z.ZodType<unknown>): Record<string, unknown> {
  // Minimal subset: object → {type:'object', properties, required}
  // Zod v3 exposes .shape on ZodObject.  Fall back to {} otherwise.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType<unknown>>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = describeZod(value);
      if (!value.isOptional()) required.push(key);
    }
    const out: Record<string, unknown> = { type: 'object', properties };
    if (required.length) out.required = required;
    return out;
  }
  return {};
}

function describeZod(z: z.ZodType<unknown>): Record<string, unknown> {
  const desc = (z.description ? { description: z.description } : {});
  if (z instanceof z.ZodString)  return { ...desc, type: 'string' };
  if (z instanceof z.ZodNumber)  return { ...desc, type: 'number' };
  if (z instanceof z.ZodBoolean) return { ...desc, type: 'boolean' };
  if (z instanceof z.ZodArray)   return { ...desc, type: 'array', items: describeZod(z.element) };
  if (z instanceof z.ZodEnum)    return { ...desc, type: 'string', enum: z.values };
  if (z instanceof z.ZodObject)  return zodToJsonSchemaSafe(z);
  if (z instanceof z.ZodOptional) return describeZod(z.unwrap());
  if (z instanceof z.ZodNullable) return { ...describeZod(z.unwrap()), nullable: true };
  return desc;
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors（若原有报错数不变则视为通过；记录 baseline）。

- [ ] **Step 3: Commit**

```bash
git add ui/src/mcp/server.ts
git commit -m "feat(mcp): export listToolSchemas for chat adapter"
```

---

## Task 3: chat/auth.ts — 工具白名单与角色裁剪

**Files:**
- Create: `ui/src/lib/chat/auth.ts`
- Create: `ui/tests/chat/auth.test.ts`

- [ ] **Step 1: 写测试**

```ts
// ui/tests/chat/auth.test.ts
import { describe, it, expect } from 'vitest';
import { filterToolsByRole, WRITE_TOOL_WHITELIST } from '@/lib/chat/auth';

const fakeTools = [
  { name: 'get_brand_stores',           description: 'a', input_schema: {} },
  { name: 'upload_bank_txn_file',       description: 'a', input_schema: {} },
  { name: 'submit_approval_proposal',   description: 'a', input_schema: {} },
  { name: 'rerun_match_by_file',        description: 'a', input_schema: {} },
  { name: 'query_financial_statement',  description: 'a', input_schema: {} },
];

describe('WRITE_TOOL_WHITELIST', () => {
  it('matches the 8 write tools documented in the spec', () => {
    expect(WRITE_TOOL_WHITELIST).toEqual(new Set([
      'upload_bank_txn_file',
      'upload_gelatomiiix_income_detail',
      'upload_bonjur_income_detail',
      'upload_bonjur_product_sales',
      'upload_bonjur_sales_self_service',
      'upload_tamkoko_inventory',
      'submit_approval_proposal',
      'rerun_match_by_file',
    ]));
  });
});

describe('filterToolsByRole', () => {
  it('admin: all tools', () => {
    const out = filterToolsByRole('admin', fakeTools);
    expect(out.map(t => t.name)).toEqual(fakeTools.map(t => t.name));
  });

  it('operator: drops all 8 write tools, keeps 2 read tools', () => {
    const out = filterToolsByRole('operator', fakeTools);
    expect(out.map(t => t.name)).toEqual(['get_brand_stores', 'query_financial_statement']);
  });

  it('null role: same as operator (defense in depth)', () => {
    const out = filterToolsByRole(null, fakeTools);
    expect(out.map(t => t.name)).toEqual(['get_brand_stores', 'query_financial_statement']);
  });
});

describe('isWriteAllowed', () => {
  it('admin can call write tools', () => {
    // implicit via filterToolsByRole
    expect(filterToolsByRole('admin', fakeTools).some(t => t.name === 'upload_bank_txn_file')).toBe(true);
  });
  it('non-admin cannot', () => {
    expect(filterToolsByRole('operator', fakeTools).some(t => t.name === 'upload_bank_txn_file')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && npx vitest run tests/chat/auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 实现**

```ts
// ui/src/lib/chat/auth.ts
// Spec §5: write whitelist + role-based tool filtering.

export const WRITE_TOOL_WHITELIST: Set<string> = new Set([
  'upload_bank_txn_file',
  'upload_gelatomiiix_income_detail',
  'upload_bonjur_income_detail',
  'upload_bonjur_product_sales',
  'upload_bonjur_sales_self_service',
  'upload_tamkoko_inventory',
  'submit_approval_proposal',
  'rerun_match_by_file',
]);

export type ChatUserRole = 'admin' | 'operator' | null;

export function filterToolsByRole<T extends { name: string }>(
  role: ChatUserRole,
  tools: T[],
): T[] {
  if (role === 'admin') return tools;
  // operator or null: strip the 8 write tools.
  return tools.filter(t => !WRITE_TOOL_WHITELIST.has(t.name));
}

export function isWriteAllowedForRole(role: ChatUserRole, toolName: string): boolean {
  if (role !== 'admin') return false;
  return WRITE_TOOL_WHITELIST.has(toolName);
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && npx vitest run tests/chat/auth.test.ts
```

Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/auth.ts ui/tests/chat/auth.test.ts
git commit -m "feat(chat): role-based tool whitelist + filterToolsByRole"
```

---

## Task 4: chat/prompt.ts — 系统提示

**Files:**
- Create: `ui/src/lib/chat/prompt.ts`
- Create: `ui/tests/chat/prompt.test.ts`

- [ ] **Step 1: 写测试**

```ts
// ui/tests/chat/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, PageCtx } from '@/lib/chat/prompt';

const baseTools = [
  { name: 'get_brand_stores', description: 'desc-a', input_schema: {} },
  { name: 'query_store_report_snapshot', description: 'desc-b', input_schema: {} },
];

describe('buildSystemPrompt', () => {
  it('includes the 4 context fields when set', () => {
    const ctx: PageCtx = { brand: 'bonjur', store: 'wz_ra', period: '2026-04', page: 'financial' };
    const out = buildSystemPrompt(ctx, baseTools);
    expect(out).toContain('brand=bonjur');
    expect(out).toContain('store=wz_ra');
    expect(out).toContain('period=2026-04');
    expect(out).toContain('page=financial');
  });

  it('marks unset context fields as <none>', () => {
    const out = buildSystemPrompt({}, baseTools);
    expect(out).toContain('brand=<none>');
    expect(out).toContain('store=<none>');
  });

  it('lists every tool name', () => {
    const out = buildSystemPrompt({}, baseTools);
    expect(out).toContain('get_brand_stores');
    expect(out).toContain('query_store_report_snapshot');
  });

  it('includes the "use tools, do not make up numbers" rule', () => {
    const out = buildSystemPrompt({}, baseTools);
    expect(out).toMatch(/use tools/i);
    expect(out).toMatch(/don't make up numbers/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && npx vitest run tests/chat/prompt.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 实现**

```ts
// ui/src/lib/chat/prompt.ts
// Spec §4.2: system prompt template. Pure function — no I/O.

export interface PageCtx {
  brand?: string;
  store?: string;
  period?: string;
  page?: string;
}

export interface ToolSchemaLite {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function buildSystemPrompt(
  ctx: PageCtx,
  tools: ToolSchemaLite[],
): string {
  const brand = ctx.brand ?? '<none>';
  const store = ctx.store ?? '<none>';
  const period = ctx.period ?? '<none>';
  const page = ctx.page ?? '<none>';

  const toolList = tools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  return `You are a data analyst assistant for the WDG data platform (蜜可诗 / Bonjour / 泰柯茶园).

Current context: brand=${brand}, store=${store}, period=${period}, page=${page}.

You have access to ${tools.length} MCP tools:
${toolList}

Rules:
- Use tools. Don't make up numbers. If a number is not in tool output, say so explicitly.
- If the user asks a question in Chinese, respond in Chinese.
- If the user asks for a report export, call query_store_report_snapshot / _trend, then surface a download URL via the tool result's "attachment_url" field if present.
- If a tool returns an error, try a different tool or ask the user to clarify.
- Don't call more than 5 tools in one chain unless the user explicitly asks.`;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && npx vitest run tests/chat/prompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/prompt.ts ui/tests/chat/prompt.test.ts
git commit -m "feat(chat): buildSystemPrompt helper"
```

---

## Task 5: chat/mcp-bridge.ts — 翻译 tool_use 到 JSON-RPC

**Files:**
- Create: `ui/src/lib/chat/mcp-bridge.ts`
- Create: `ui/tests/chat/mcp-bridge.test.ts`

- [ ] **Step 1: 写测试**

```ts
// ui/tests/chat/mcp-bridge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolUseToMcpRequest, parseMcpResult, McpCallError } from '@/lib/chat/mcp-bridge';

describe('toolUseToMcpRequest', () => {
  it('builds a valid JSON-RPC 2.0 tools/call envelope', () => {
    const out = toolUseToMcpRequest('tool_42', 'get_brand_stores', { brand: 'bonjur' }, 7);
    expect(out).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'get_brand_stores', arguments: { brand: 'bonjur' } },
    });
  });
});

describe('parseMcpResult', () => {
  it('extracts text content from a successful response', () => {
    const r = parseMcpResult({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: '{"brands":[]}' }] },
    });
    expect(r).toEqual({ ok: true, text: '{"brands":[]}' });
  });

  it('returns an McpCallError on JSON-RPC error', () => {
    const r = parseMcpResult({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'Invalid params' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r).toBeInstanceOf(McpCallError);
      expect(r.message).toBe('Invalid params');
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && npx vitest run tests/chat/mcp-bridge.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 实现**

```ts
// ui/src/lib/chat/mcp-bridge.ts
// Spec §3 / §4.3: translate Claude tool_use blocks into JSON-RPC 2.0
// requests for /api/mcp.

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function toolUseToMcpRequest(
  toolUseId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  rpcId: number | string,
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'tools/call',
    params: { name: toolName, arguments: toolInput },
  };
}

export class McpCallError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'McpCallError';
  }
}

export type McpResult =
  | { ok: true; text: string }
  | McpCallError;

export function parseMcpResult(body: unknown): McpResult {
  if (typeof body !== 'object' || body === null) {
    return new McpCallError(-32700, 'Non-object JSON-RPC response');
  }
  const b = body as { error?: { code: number; message: string }; result?: { content?: Array<{ type: string; text?: string }> } };
  if (b.error) {
    return new McpCallError(b.error.code, b.error.message);
  }
  const first = b.result?.content?.[0];
  if (first?.type === 'text' && typeof first.text === 'string') {
    return { ok: true, text: first.text };
  }
  return new McpCallError(-32603, 'Unexpected MCP response shape');
}

/**
 * POST a JSON-RPC request to the local /api/mcp endpoint.
 * Caller passes cookies for auth (forwarded from chat request).
 */
export async function callMcp(
  request: JsonRpcRequest,
  cookieHeader: string | null,
  baseUrl: string,
): Promise<McpResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
  } catch (e) {
    return new McpCallError(-32603, `fetch failed: ${(e as Error).message}`);
  }

  if (!res.ok) {
    return new McpCallError(res.status, `MCP HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    return new McpCallError(-32700, `non-JSON response: ${(e as Error).message}`);
  }
  return parseMcpResult(body);
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && npx vitest run tests/chat/mcp-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/mcp-bridge.ts ui/tests/chat/mcp-bridge.test.ts
git commit -m "feat(chat): mcp-bridge — toolUse → JSON-RPC 2.0"
```

---

## Task 6: chat/stream.ts — SSE 编解码

**Files:**
- Create: `ui/src/lib/chat/stream.ts`
- Create: `ui/tests/chat/sse.test.ts`

- [ ] **Step 1: 写测试**

```ts
// ui/tests/chat/sse.test.ts
import { describe, it, expect } from 'vitest';
import { encodeSseEvent, parseSseStream } from '@/lib/chat/stream';

describe('encodeSseEvent', () => {
  it('encodes a typed event with JSON data and double newlines', () => {
    const out = encodeSseEvent({ type: 'text_delta', text: 'hi' });
    expect(out).toBe('event: text_delta\ndata: {"type":"text_delta","text":"hi"}\n\n');
  });
});

describe('parseSseStream', () => {
  function collect(chunk: string) {
    const events: unknown[] = [];
    parseSseStream(chunk, e => events.push(e));
    return events;
  }

  it('parses a single event from one chunk', () => {
    const events = collect('event: ping\ndata: {"x":1}\n\n');
    expect(events).toEqual([{ x: 1 }]);
  });

  it('parses two events split across two chunks', () => {
    const a: unknown[] = [];
    const cb = (e: unknown) => a.push(e);
    parseSseStream('event: a\ndata: {"i":1}\n\nevent: b\ndata: ', cb);
    parseSseStream('{"i":2}\n\n', cb);
    expect(a).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it('skips keepalive comments', () => {
    const events = collect(': keepalive\nevent: x\ndata: {"y":2}\n\n');
    expect(events).toEqual([{ y: 2 }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && npx vitest run tests/chat/sse.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 实现**

```ts
// ui/src/lib/chat/stream.ts
// SSE wire format: "event: <name>\ndata: <json>\n\n". Comments start with ":".

export type SseEvent = Record<string, unknown> & { type: string };

export function encodeSseEvent(evt: SseEvent): string {
  return `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
}

/**
 * Streaming parser. Buffer chunks and split on the SSE record separator
 * (blank line). For each completed record, dispatch to `onEvent`.
 *
 * Keepalive lines (start with ':') are ignored. Multi-line `data:` is
 * joined with '\n' per the SSE spec.
 */
export function parseSseStream(
  chunk: string,
  onEvent: (evt: SseEvent) => void,
): void {
  // We rely on the producer emitting one record per chunk boundary in
  // practice (encodeSseEvent only emits one record at a time), but we
  // still split on the blank-line separator for safety.
  const records = chunk.split('\n\n');
  for (const rec of records) {
    const trimmed = rec.replace(/\n+$/, '');
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    let data = '';
    let eventName: string | null = null;
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      else if (field === 'data') {
        data = data ? data + '\n' + value : value;
      }
    }
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as SseEvent;
      if (eventName) parsed.type = eventName;
      onEvent(parsed);
    } catch {
      // ignore malformed lines
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && npx vitest run tests/chat/sse.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/stream.ts ui/tests/chat/sse.test.ts
git commit -m "feat(chat): SSE encode/parse helpers"
```

---

## Task 7: chat/session-store.ts — 进程内会话存储

**Files:**
- Create: `ui/src/lib/chat/session-store.ts`

- [ ] **Step 1: 实现（无单测 — 留 mock 测在 API 集成测里）**

```ts
// ui/src/lib/chat/session-store.ts
// Spec §7: in-memory chat history, 30-min TTL. Not persisted in v1.

import { randomUUID } from 'crypto';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown; result?: string; isError?: boolean }>;
  ts: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  context: { brand?: string; store?: string; period?: string; page?: string };
  messages: ChatMessage[];
  updatedAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const store = new Map<string, ChatSession>();
let lastSweep = Date.now();

function sweepIfStale() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [id, sess] of store) {
    if (now - sess.updatedAt > TTL_MS) store.delete(id);
  }
}

export function getOrCreateSession(userId: string): ChatSession {
  sweepIfStale();
  // Find the most recent session for this user (v1: single session per user).
  let latest: ChatSession | null = null;
  for (const sess of store.values()) {
    if (sess.userId !== userId) continue;
    if (!latest || sess.updatedAt > latest.updatedAt) latest = sess;
  }
  if (latest) return latest;
  const sess: ChatSession = {
    id: randomUUID(),
    userId,
    context: {},
    messages: [],
    updatedAt: Date.now(),
  };
  store.set(sess.id, sess);
  return sess;
}

export function getSession(id: string): ChatSession | undefined {
  sweepIfStale();
  return store.get(id);
}

export function updateSession(id: string, patch: Partial<ChatSession>): void {
  const sess = store.get(id);
  if (!sess) return;
  Object.assign(sess, patch, { updatedAt: Date.now() });
}

export function appendMessage(id: string, msg: ChatMessage): void {
  const sess = store.get(id);
  if (!sess) return;
  sess.messages.push(msg);
  sess.updatedAt = Date.now();
}

export function resetSession(id: string): void {
  const sess = store.get(id);
  if (!sess) return;
  sess.messages = [];
  sess.context = {};
  sess.updatedAt = Date.now();
}

/** For tests: clear all sessions. */
export function _clearAllForTests(): void {
  store.clear();
  lastSweep = Date.now();
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/chat/session-store.ts
git commit -m "feat(chat): in-memory session store with 30-min TTL"
```

---

## Task 8: 安装 @anthropic-ai/sdk

**Files:**
- Modify: `ui/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd ui && npm install @anthropic-ai/sdk
```

Expected: package.json 新增 `"@anthropic-ai/sdk": "^x.y.z"` 到 dependencies。

- [ ] **Step 2: TypeScript 类型存在性验证**

```bash
cd ui && npx tsc --noEmit --moduleResolution node --target es2022 \
  --module esnext --esModuleInterop true --skipLibCheck \
  -e "import Anthropic from '@anthropic-ai/sdk'; const c = new Anthropic({apiKey:'x'});" 2>&1 | head -5
```

或更简单：建一个临时检查文件。

```bash
cd ui && node -e "console.log(require('@anthropic-ai/sdk').default ? 'ok' : 'missing default')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add ui/package.json ui/package-lock.json
git commit -m "chore(ui): add @anthropic-ai/sdk dependency"
```

---

## Task 9: api/chat/history + context 端点

**Files:**
- Create: `ui/src/app/api/chat/history/route.ts`
- Create: `ui/src/app/api/chat/context/route.ts`

- [ ] **Step 1: 实现 history GET**

```ts
// ui/src/app/api/chat/history/route.ts
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { getOrCreateSession, resetSession } from '@/lib/chat/session-store';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sess = getOrCreateSession(user.user_id);
  return NextResponse.json({
    sessionId: sess.id,
    context:   sess.context,
    messages:  sess.messages,
  });
}
```

- [ ] **Step 2: 实现 context POST**

```ts
// ui/src/app/api/chat/context/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { getOrCreateSession, updateSession, resetSession } from '@/lib/chat/session-store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sess = getOrCreateSession(user.user_id);
  if (body.reset === true) {
    resetSession(sess.id);
    return NextResponse.json({ sessionId: sess.id, context: {}, messages: [] });
  }
  const ctx = (body.context ?? {}) as Record<string, string | undefined>;
  updateSession(sess.id, {
    context: {
      brand:  ctx.brand  ?? sess.context.brand,
      store:  ctx.store  ?? sess.context.store,
      period: ctx.period ?? sess.context.period,
      page:   ctx.page   ?? sess.context.page,
    },
  });
  return NextResponse.json({ sessionId: sess.id, context: sess.context });
}
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/app/api/chat/history/route.ts ui/src/app/api/chat/context/route.ts
git commit -m "feat(chat): history GET + context POST endpoints"
```

---

## Task 10: api/chat/route.ts — 核心 SSE 端点

**Files:**
- Create: `ui/src/app/api/chat/route.ts`

- [ ] **Step 1: 实现 SSE 端点（无单测，端到端走手动验收）**

```ts
// ui/src/app/api/chat/route.ts
// Spec §3 / §4.3: main SSE endpoint. Runs the Claude tool-use loop and
// streams progress to the browser.

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionUser } from '@/lib/auth-server';
import { getOrCreateSession, appendMessage, updateSession } from '@/lib/chat/session-store';
import { listToolSchemas } from '@/mcp/server';
import { filterToolsByRole, isWriteAllowedForRole, WRITE_TOOL_WHITELIST } from '@/lib/chat/auth';
import { buildSystemPrompt } from '@/lib/chat/prompt';
import { callMcp, McpCallError } from '@/lib/chat/mcp-bridge';
import { encodeSseEvent } from '@/lib/chat/stream';

export const runtime = 'nodejs';
export const maxDuration = 60;  // seconds; 1 message turn

const MAX_TOOL_CHAIN_DEPTH = 5;

function getBaseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  // ---------- 1. auth ----------
  const user = await getSessionUser();
  if (!user) {
    return new Response('unauthorized', { status: 401 });
  }

  // ---------- 2. parse body (text or multipart) ----------
  const contentType = req.headers.get('content-type') ?? '';
  let userText = '';
  let toolDepth = 0;
  let rpcIdCounter = 1;
  let sessionId: string | null = null;

  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData();
    userText = (form.get('text') as string | null) ?? '';
    // files are dropped at the SSE endpoint in v1 — they go through
    // a separate /api/upload flow. We accept the field but ignore it.
  } else {
    const body = await req.json().catch(() => ({}));
    userText = (body.text as string | null) ?? '';
  }

  if (!userText.trim()) {
    return new Response('empty message', { status: 400 });
  }

  // ---------- 3. session ----------
  const sess = getOrCreateSession(user.user_id);
  sessionId = sess.id;
  appendMessage(sess.id, { role: 'user', content: userText, ts: Date.now() });

  // ---------- 4. build prompt + tools ----------
  const allTools = listToolSchemas();
  const tools = filterToolsByRole(user.role, allTools);
  const system = buildSystemPrompt(sess.context, tools);

  // ---------- 5. SSE stream ----------
  const cookieHeader = req.headers.get('cookie');
  const baseUrl = getBaseUrl(req);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Convert stored messages → Anthropic format
  const apiMessages = sess.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(encodeSseEvent(evt as { type: string })));
      };
      try {
        send({ type: 'session', sessionId: sess.id });

        let runningMessages = apiMessages;
        let stopReason: string | null = null;

        while (stopReason !== 'end_turn') {
          if (toolDepth >= MAX_TOOL_CHAIN_DEPTH) {
            send({ type: 'error', message: 'tool chain too deep' });
            break;
          }

          const response = await client.messages.create({
            model: 'claude-opus-4-8',
            system,
            tools: tools as Anthropic.Tool[],
            messages: runningMessages,
            max_tokens: 4096,
          });

          // Stream text + collect tool_use blocks
          const assistantTextParts: string[] = [];
          const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];

          for (const block of response.content) {
            if (block.type === 'text') {
              assistantTextParts.push(block.text);
              send({ type: 'text_delta', text: block.text });
            } else if (block.type === 'tool_use') {
              toolUseBlocks.push({ id: block.id, name: block.name, input: block.input });
              send({ type: 'tool_start', id: block.id, name: block.name });
            }
          }

          stopReason = response.stop_reason ?? null;

          // Persist assistant turn
          const assistantContent = assistantTextParts.join('\n');
          if (assistantContent || toolUseBlocks.length) {
            appendMessage(sess.id, {
              role: 'assistant',
              content: assistantContent,
              toolCalls: toolUseBlocks.map(tb => ({ id: tb.id, name: tb.name, input: tb.input })),
              ts: Date.now(),
            });
          }

          // No tool calls → done
          if (toolUseBlocks.length === 0 || stopReason === 'end_turn') break;

          // Execute each tool_use
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
          for (const tb of toolUseBlocks) {
            // Server-side write whitelist guard
            if (WRITE_TOOL_WHITELIST.has(tb.name) && !isWriteAllowedForRole(user.role, tb.name)) {
              const errText = 'WRITE_NOT_ALLOWED';
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: errText, is_error: true });
              send({ type: 'tool_end', id: tb.id, name: tb.name, isError: true, summary: errText });
              continue;
            }
            const t0 = Date.now();
            const result = await callMcp(
              {
                jsonrpc: '2.0',
                id: rpcIdCounter++,
                method: 'tools/call',
                params: { name: tb.name, arguments: tb.input as Record<string, unknown> },
              },
              cookieHeader,
              baseUrl,
            );
            const durMs = Date.now() - t0;
            if (result instanceof McpCallError) {
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result.message, is_error: true });
              send({ type: 'tool_end', id: tb.id, name: tb.name, isError: true, summary: result.message, durationMs: durMs });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result.text });
              send({ type: 'tool_end', id: tb.id, name: tb.name, summary: result.text.slice(0, 200), durationMs: durMs });
            }
          }
          toolDepth++;

          // Feed results back to Claude
          runningMessages = [
            ...runningMessages,
            { role: 'assistant' as const, content: response.content as Anthropic.ContentBlockParam[] },
            { role: 'user' as const, content: toolResults },
          ];
        }

        send({ type: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Log server-side; send generic to client for 401/403
        console.error('[chat] error:', msg);
        if (msg.includes('401') || msg.includes('authentication')) {
          send({ type: 'error', message: 'AI service not configured (ANTHROPIC_API_KEY missing or invalid)' });
        } else {
          send({ type: 'error', message: msg });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
    },
  });
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/app/api/chat/route.ts
git commit -m "feat(chat): SSE endpoint POST /api/chat"
```

---

## Task 11: 组件 — types.ts

**Files:**
- Create: `ui/src/components/chat/types.ts`

- [ ] **Step 1: 实现**

```ts
// ui/src/components/chat/types.ts

export interface PageContextValue {
  brand?:  string;
  store?:  string;
  period?: string;
  page?:   string;
}

export type ChatRole = 'user' | 'assistant';

export interface ToolCallLite {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  durationMs?: number;
}

export type ChatMessage =
  | { type: 'user';           content: string; ts: number }
  | { type: 'assistant_text'; content: string; ts: number }
  | { type: 'tool_call';      call: ToolCallLite; ts: number }
  | { type: 'error';          message: string; ts: number };

export type SseIncoming =
  | { type: 'session';    sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_end';   id: string; name: string; summary?: string; isError?: boolean; durationMs?: number }
  | { type: 'done' }
  | { type: 'error';      message: string };
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/chat/types.ts
git commit -m "feat(chat): shared types"
```

---

## Task 12: PageContext Provider

**Files:**
- Create: `ui/src/components/chat/PageContext.tsx`

- [ ] **Step 1: 实现**

```tsx
// ui/src/components/chat/PageContext.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { PageContextValue } from './types';

const Ctx = createContext<PageContextValue>({});

export function usePageContext() { return useContext(Ctx); }

/**
 * Derives { brand, store, period, page } from window.location on every
 * navigation. Posts deltas to /api/chat/context.
 */
export function PageContextProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<PageContextValue>({});

  useEffect(() => {
    function readFromUrl() {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const page = url.pathname.replace(/^\/u\//, '').split('/')[0] || '<none>';
      setCtx({
        brand:  url.searchParams.get('brand')  ?? undefined,
        store:  url.searchParams.get('store')  ?? undefined,
        period: url.searchParams.get('period') ?? undefined,
        page,
      });
    }
    readFromUrl();
    window.addEventListener('popstate', readFromUrl);
    // Patch pushState/replaceState to fire 'popstate' on SPA nav.
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...a) { origPush.apply(this, a); window.dispatchEvent(new PopStateEvent('popstate')); };
    history.replaceState = function (...a) { origReplace.apply(this, a); window.dispatchEvent(new PopStateEvent('popstate')); };
    return () => {
      window.removeEventListener('popstate', readFromUrl);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  // Push context to server on every change
  useEffect(() => {
    if (Object.keys(ctx).length === 0) return;
    fetch('/api/chat/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx }),
    }).catch(() => { /* offline / logged out — ignore */ });
  }, [ctx.brand, ctx.store, ctx.period, ctx.page]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/PageContext.tsx
git commit -m "feat(chat): PageContext provider syncing URL → server"
```

---

## Task 13: MessageList 组件

**Files:**
- Create: `ui/src/components/chat/MessageList.tsx`

- [ ] **Step 1: 实现**

```tsx
// ui/src/components/chat/MessageList.tsx
'use client';
import { useState } from 'react';
import type { ChatMessage, ToolCallLite } from './types';

function ToolCallBlock({ call }: { call: ToolCallLite }) {
  const [open, setOpen] = useState(false);
  const status = call.isError ? '❌' : '✅';
  return (
    <div className="my-1 rounded border border-gray-200 bg-gray-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-2 py-1 text-left text-gray-700 hover:bg-gray-100"
      >
        {status} <code>{call.name}</code>
        {call.durationMs != null && <span className="ml-2 text-gray-400">{call.durationMs}ms</span>}
      </button>
      {open && (
        <div className="border-t border-gray-200 px-2 py-1">
          <div className="text-gray-500">input:</div>
          <pre className="overflow-auto text-[10px]">{JSON.stringify(call.input, null, 2)}</pre>
          {call.result && (
            <>
              <div className="mt-1 text-gray-500">result:</div>
              <pre className="overflow-auto text-[10px]">{call.result.slice(0, 2000)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
      {messages.map((m, i) => {
        if (m.type === 'user') {
          return (
            <div key={i} className="rounded bg-blue-50 px-3 py-2 text-gray-900">
              {m.content}
            </div>
          );
        }
        if (m.type === 'assistant_text') {
          return (
            <div key={i} className="rounded bg-white px-3 py-2 text-gray-900 shadow-sm">
              {m.content}
            </div>
          );
        }
        if (m.type === 'tool_call') {
          return <ToolCallBlock key={i} call={m.call} />;
        }
        return (
          <div key={i} className="rounded bg-red-50 px-3 py-2 text-red-800">
            ⚠️ {m.message}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/MessageList.tsx
git commit -m "feat(chat): MessageList with collapsible tool-call blocks"
```

---

## Task 14: ChatInput 组件

**Files:**
- Create: `ui/src/components/chat/ChatInput.tsx`

- [ ] **Step 1: 实现**

```tsx
// ui/src/components/chat/ChatInput.tsx
'use client';
import { useState, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  onReset: () => void;
  disabled?: boolean;
  canUpload?: boolean;  // false for non-admin
}

export function ChatInput({ onSend, onReset, disabled, canUpload = true }: Props) {
  const [text, setText] = useState('');

  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white p-2">
      <textarea
        rows={2}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="问点什么…(Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        className="w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={!canUpload}
            title={canUpload ? '上传文件（暂未启用）' : '权限不足'}
            className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >📎 上传</button>
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50"
          >🔄 重启</button>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={disabled || !text.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >发送</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/ChatInput.tsx
git commit -m "feat(chat): ChatInput with send + reset + upload button"
```

---

## Task 15: ChatWidget 组件

**Files:**
- Create: `ui/src/components/chat/ChatWidget.tsx`

- [ ] **Step 1: 实现**

```tsx
// ui/src/components/chat/ChatWidget.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { parseSseStream } from '@/lib/chat/stream';
import type { ChatMessage, SseIncoming, ToolCallLite } from './types';

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const aborterRef = useRef<AbortController | null>(null);
  const assistantBufferRef = useRef<string>('');
  const toolCallsRef = useRef<Map<string, ToolCallLite>>(new Map());

  // Cmd/Ctrl+K global toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load history on mount
  useEffect(() => {
    if (!open) return;
    fetch('/api/chat/history').then(async r => {
      if (!r.ok) return;
      const j = await r.json();
      const restored: ChatMessage[] = [];
      for (const m of (j.messages as Array<{ role: string; content: string; toolCalls?: ToolCallLite[]; ts: number }>)) {
        if (m.role === 'user') restored.push({ type: 'user', content: m.content, ts: m.ts });
        else {
          if (m.content) restored.push({ type: 'assistant_text', content: m.content, ts: m.ts });
          for (const tc of m.toolCalls ?? []) {
            restored.push({ type: 'tool_call', call: tc, ts: m.ts });
          }
        }
      }
      setMessages(restored);
    }).catch(() => {});
  }, [open]);

  const send = useCallback(async (text: string) => {
    if (streaming) return;
    const ts = Date.now();
    setMessages(m => [...m, { type: 'user', content: text, ts }]);
    setStreaming(true);
    assistantBufferRef.current = '';
    toolCallsRef.current = new Map();

    const controller = new AbortController();
    aborterRef.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setMessages(m => [...m, { type: 'error', message: `HTTP ${res.status}`, ts: Date.now() }]);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Buffers for current assistant turn
      let assistantStarted = false;
      let lastAssistantTs = ts;

      const flushAssistantText = () => {
        if (!assistantStarted) {
          setMessages(m => [...m, { type: 'assistant_text', content: assistantBufferRef.current, ts: lastAssistantTs }]);
          assistantStarted = true;
        } else {
          // Replace the last assistant_text message with the new buffer
          setMessages(m => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].type === 'assistant_text') {
                copy[i] = { type: 'assistant_text', content: assistantBufferRef.current, ts: copy[i].ts };
                break;
              }
            }
            return copy;
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        parseSseStream(buf, (evt: SseIncoming) => {
          if (evt.type === 'text_delta' && typeof evt.text === 'string') {
            assistantBufferRef.current += evt.text;
            lastAssistantTs = Date.now();
            flushAssistantText();
          } else if (evt.type === 'tool_start') {
            const tc: ToolCallLite = { id: evt.id, name: evt.name, input: {} };
            toolCallsRef.current.set(evt.id, tc);
            setMessages(m => [...m, { type: 'tool_call', call: tc, ts: Date.now() }]);
          } else if (evt.type === 'tool_end') {
            const tc = toolCallsRef.current.get(evt.id);
            if (tc) {
              tc.result = evt.summary;
              tc.isError = !!evt.isError;
              tc.durationMs = evt.durationMs;
              setMessages(m => m.map(x => (x.type === 'tool_call' && x.call.id === evt.id) ? { ...x, call: { ...tc } } : x));
            }
          } else if (evt.type === 'error') {
            setMessages(m => [...m, { type: 'error', message: evt.message, ts: Date.now() }]);
          }
        });
        // The parser is stateless; after each chunk, keep the tail (after the last \n\n) in buf
        const lastSep = buf.lastIndexOf('\n\n');
        if (lastSep >= 0) buf = buf.slice(lastSep + 2);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(m => [...m, { type: 'error', message: (e as Error).message, ts: Date.now() }]);
      }
    } finally {
      setStreaming(false);
      aborterRef.current = null;
    }
  }, [streaming]);

  const reset = useCallback(async () => {
    await fetch('/api/chat/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });
    setMessages([]);
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="AI 助手 (Cmd/Ctrl+K)"
        className="fixed bottom-8 right-8 z-50 h-12 w-12 rounded-full bg-blue-600 text-2xl text-white shadow-lg hover:bg-blue-700"
      >💬</button>
    );
  }

  return (
    <div className="fixed bottom-8 right-8 z-50 flex h-[600px] w-[420px] flex-col rounded-lg border border-gray-300 bg-white shadow-2xl">
      <div className="flex items-center justify-between rounded-t-lg bg-blue-600 px-3 py-2 text-white">
        <span className="text-sm font-semibold">AI 助手</span>
        <button type="button" onClick={() => setOpen(false)} className="text-white hover:text-gray-200">✕</button>
      </div>
      <MessageList messages={messages} />
      <ChatInput onSend={send} onReset={reset} disabled={streaming} />
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/ChatWidget.tsx
git commit -m "feat(chat): ChatWidget with SSE consumer, reset, history"
```

---

## Task 16: 在 u/layout.tsx 挂载 PageContext + ChatWidget

**Files:**
- Create: `ui/src/app/u/layout.tsx`
- Modify: `ui/src/app/u/page.tsx`（如果 children 包装冲突）

- [ ] **Step 1: 检查 u/page.tsx 是否已含 'use client'**

```bash
head -5 ui/src/app/u/page.tsx
```

如果是 server component，没有问题——可以在 layout 注入。**如果 page.tsx 是 client component**，需要拆出 client-only 部分到内部组件，layout 保持 server。

- [ ] **Step 2: 创建 layout**

```tsx
// ui/src/app/u/layout.tsx
import { ReactNode } from 'react';
import { PageContextProvider } from '@/components/chat/PageContext';
import { ChatWidget } from '@/components/chat/ChatWidget';

export default function ULayout({ children }: { children: ReactNode }) {
  return (
    <PageContextProvider>
      {children}
      <ChatWidget />
    </PageContextProvider>
  );
}
```

- [ ] **Step 3: 若 page.tsx 与 layout 冲突则修复**

如果 `ui/src/app/u/page.tsx` 报错 "use client" + "import server-only"：

- 拆出数据获取到 `ui/src/app/u/page.tsx`（server）
- 把交互部分提取到 `ui/src/app/u/Dashboard.tsx`（client）

这是局部小重构，**只在出现冲突时做**。先尝试不修改，看编译是否通过。

- [ ] **Step 4: TypeScript + Next build 验证**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -30
```

Expected: 0 errors；`Compiling ...` 成功；`/` 路由依然存在；`/u/*` 路由依然存在。

- [ ] **Step 5: Commit**

```bash
git add ui/src/app/u/layout.tsx ui/src/app/u/page.tsx
git commit -m "feat(chat): mount PageContext + ChatWidget on /u/* layout"
```

---

## Task 17: 环境变量 + env 文档

**Files:**
- Modify: `ui/.env.example`

- [ ] **Step 1: 添加 ANTHROPIC_API_KEY**

在 `ui/.env.example` 末尾追加：

```
# Anthropic API key for /api/chat
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: 文档补充**

在 `README.md` 或 `docs/chat-acceptance.md`（新建）加一段：

````markdown
# AI Chat Widget — Acceptance

Run `npm run dev` in `ui/`. Set `ANTHROPIC_API_KEY` in `ui/.env.local`.

## Manual checklist

1. Login; open any `/u/*` page. Floating 💬 button visible bottom-right.
2. Navigate to `/u/financial?brand=bonjur&store=wz_ra&period=2026-04`. Ask "这个月营收多少" → AI answers with a number.
3. Click 📎 → button shows "权限不足" tooltip if logged in as operator.
4. Click 🔄 重启 → messages clear; AI greets with a brand/store/period question.
5. Press Cmd+K (mac) / Ctrl+K → widget toggles.
6. Inspect `ops.chat_session_log` after a chat session: 1 new row; `ops.chat_tool_call`: N rows.
7. Stop the dev server mid-conversation → restart → widget shows cached history.
8. As admin, ask for store report → tool-call block expands → summary visible.

## Edge cases

- Logged out: widget button still visible; click → first message returns "请先登录" (HTTP 401).
- ANTHROPIC_API_KEY missing: AI message says "AI service not configured".
- Tool chain depth > 5: server sends `{type:'error', message:'tool chain too deep'}`.
````

- [ ] **Step 3: Commit**

```bash
git add ui/.env.example README.md docs/chat-acceptance.md
git commit -m "docs(chat): env example + acceptance checklist"
```

---

## Task 18: 整体构建验证

- [ ] **Step 1: 跑所有单测**

```bash
cd ui && npx vitest run
```

Expected: 所有测试 PASS。

- [ ] **Step 2: 跑 DDL pytest**

```bash
pytest tests/test_chat_ddl.py -v
```

Expected: 3 PASS（如果 DATABASE_URL 已设）。

- [ ] **Step 3: TypeScript 检查**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors。

- [ ] **Step 4: Next.js build**

```bash
cd ui && npx next build 2>&1 | tail -30
```

Expected: 编译成功，路由表无新增 ERROR。

- [ ] **Step 5: 手动验收**

按 `docs/chat-acceptance.md` 8 条清单人肉过一遍。

- [ ] **Step 6: 最后 commit（如有遗漏文件）**

```bash
git status
# 如果有未跟踪改动：
git add -A && git commit -m "chore(chat): post-build cleanup"
```

---

## 自审记录

1. **Spec 覆盖**：
   - §1 概述 → Task 1-16
   - §2 范围（包含/不包含） → 全部按"不包含"跳过
   - §3 架构 → Task 10 (SSE route)
   - §4 组件与数据流 → Task 11-15
   - §4.2 上下文同步 → Task 9 (context POST) + Task 12 (PageContext)
   - §4.3 服务端循环 → Task 10
   - §4.4 文件上传 → Task 14 (button disabled 一期 YAGNI；端点接收 multipart 但忽略 files)
   - §4.5 Excel 导出 → 不在一期范围（spec 列为可选；已删除 — 验收清单无此项）
   - §5 鉴权与权限 → Task 3 + Task 10 (server-side 兜底)
   - §6 错误处理 → Task 10
   - §7 数据与隐私 → Task 7 (内存 30min TTL)
   - §8 速率限制 → 不在一期范围（spec 列为范围；未实现 — **需要回填**）
   - §9 审计 → Task 1
   - §10 测试与验收 → Task 3-6, 18
   - §11 风险 → 默认防护已加
   - §12 文件清单 → 全部完成

2. **占位符扫描**：无 TBD/TODO。

3. **类型一致性**：
   - `filterToolsByRole` 在 Task 3、10 都用同样的签名
   - `listToolSchemas()` 在 Task 2、10 都用
   - `ChatMessage` 在 Task 11 定义，Task 13-15 都引用

4. **发现缺口**：
   - §8 速率限制未在 plan 中实现。补一个简单中间件。
   - §4.4 文件上传：spec 说"在聊天框中上传文件"勾选了，但本期 YAGNI（按钮 disabled）。需要在 ChatInput 加 disabled tooltip 提示（一期用户已能看见按钮但不能用，符合"按钮禁用并显示权限不足 tooltip"验收）。

5. **修复**：新增 Task 19：速率限制中间件。

---

## Task 19（补）：60s 10 消息速率限制

**Files:**
- Create: `ui/src/lib/chat/rate-limit.ts`
- Modify: `ui/src/app/api/chat/route.ts`

- [ ] **Step 1: 实现**

```ts
// ui/src/lib/chat/rate-limit.ts
// Spec §8: 60s window, max 10 messages per user. In-memory.

const WINDOW_MS = 60_000;
const MAX = 10;
const hits = new Map<string, number[]>();

export function checkRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const arr = (hits.get(userId) ?? []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  hits.set(userId, arr);
  return { ok: true };
}

export function _clearForTests(): void { hits.clear(); }
```

- [ ] **Step 2: 在 chat/route.ts 接入**

在 `ui/src/app/api/chat/route.ts` 顶部 import 处追加：

```ts
import { checkRateLimit } from '@/lib/chat/rate-limit';
```

在 `// ---------- 1. auth ----------` 之后插入：

```ts
  // ---------- 1.5 rate limit ----------
  const rl = checkRateLimit(user.user_id);
  if (!rl.ok) {
    return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    });
  }
```

- [ ] **Step 3: TypeScript + build 验证**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/chat/rate-limit.ts ui/src/app/api/chat/route.ts
git commit -m "feat(chat): 60s/10msg rate limit per user"
```

---

## 实施完成后的可选任务（YAGNI——本期不做）

- ❌ §4.4 文件上传（按钮 disabled 留接口）
- ❌ §4.5 Excel 导出联动（`attachment_url` 字段可由工具返回，但前端不渲染下载按钮）
- ❌ 聊天历史持久化（`ops.chat_session_log` 表已建，路由写一条 session 记录可作为后续 PR）
- ❌ 多会话侧边栏

---

## 验收目标（与 spec §10.5 一致）

- [ ] `cd ui && npx vitest run` 全过
- [ ] `pytest tests/test_chat_ddl.py -v` 全过（若 DB 可达）
- [ ] `cd ui && npx tsc --noEmit` 0 错误
- [ ] `cd ui && npx next build` 成功
- [ ] `docs/chat-acceptance.md` 8 条人肉清单全过
