# Chat Agent Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 chat widget 升级为真正的数据 agent：thinking text 可见、错误自动重试、token 软压、链深度上调。

**Architecture:** 在 `feat/ai-chat-widget` 现有架构基础上：1) `buildSystemPrompt` 加 `compact` 形参；2) `callMcp` 包 `callMcpWithRetry` 重试 wrapper；3) 新增 `token-tracker.ts` 累加 usage；4) 3 个新 SSE event 类型；5) UI 渲染 thinking 和重试。

**Tech Stack:** Next.js 14, TypeScript, Anthropic SDK, node --test.

---

## File Structure

```
ui/src/lib/chat/
  mcp-bridge.ts          # MODIFY: add callMcpWithRetry
  prompt.ts              # MODIFY: compact 形参，深度 5→10
  token-tracker.ts       # NEW
  stream.ts              # (无变化)

ui/src/components/chat/
  types.ts               # MODIFY: SseIncoming 加 3 个类型
  MessageList.tsx        # MODIFY: thinking_delta 渲染
  ChatWidget.tsx         # MODIFY: 3 个新 event handler

ui/src/app/api/chat/
  route.ts               # MODIFY: 集成 token tracker + retry + 3 个新 SSE event

ui/tests/chat/
  mcp-bridge.test.ts    # MODIFY: retry 测试
  prompt.test.ts         # MODIFY: compact 测试
  token-tracker.test.ts  # NEW
```

---

## Task 1: `token-tracker.ts` + tests

**Files:**
- Create: `ui/src/lib/chat/token-tracker.ts`
- Create: `ui/tests/chat/token-tracker.test.ts`

- [ ] **Step 1: 写测试**

```ts
// ui/tests/chat/token-tracker.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { createTokenTracker, SOFT_LIMIT, HARD_LIMIT } from '../../src/lib/chat/token-tracker.ts';

test('initial level is normal with 0 tokens', () => {
  const t = createTokenTracker();
  const { usage, level } = t.record(0, 0);
  assert.equal(level, 'normal');
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
});

test('cumulative tokens stay under soft limit', () => {
  const t = createTokenTracker();
  t.record(30_000, 20_000);
  const { level } = t.record(20_000, 5_000);
  assert.equal(level, 'normal'); // 75K total
  assert.equal(SOFT_LIMIT, 80_000);
});

test('soft limit triggers when cumulative >= 80K', () => {
  const t = createTokenTracker();
  t.record(40_000, 20_000); // 60K
  const { level } = t.record(15_000, 10_000); // +25K = 85K total
  assert.equal(level, 'soft');
});

test('hard limit triggers when cumulative >= 200K', () => {
  const t = createTokenTracker();
  t.record(100_000, 50_000);
  const { level } = t.record(50_000, 5_000); // 205K total
  assert.equal(level, 'hard');
  assert.equal(HARD_LIMIT, 200_000);
});

test('getUsage returns accumulated totals', () => {
  const t = createTokenTracker();
  t.record(10_000, 5_000);
  t.record(20_000, 15_000);
  const u = t.getUsage();
  assert.equal(u.inputTokens, 30_000);
  assert.equal(u.outputTokens, 20_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && node --test --experimental-strip-types tests/chat/token-tracker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 实现**

```ts
// ui/src/lib/chat/token-tracker.ts
// Per-session token accumulator. Soft-compresses the system prompt at
// SOFT_LIMIT; hard-aborts at HARD_LIMIT.

export const SOFT_LIMIT = 80_000;
export const HARD_LIMIT = 200_000;

export type TokenLevel = 'normal' | 'soft' | 'hard';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  lastReportedAt: number;
}

export function createTokenTracker() {
  let inputTokens = 0;
  let outputTokens = 0;
  let lastReportedAt = 0;

  function level(): TokenLevel {
    const total = inputTokens + outputTokens;
    if (total >= HARD_LIMIT) return 'hard';
    if (total >= SOFT_LIMIT) return 'soft';
    return 'normal';
  }

  return {
    record(input: number, output: number): { usage: TokenUsage; level: TokenLevel } {
      inputTokens += input;
      outputTokens += output;
      lastReportedAt = Date.now();
      return {
        usage: { inputTokens, outputTokens, lastReportedAt },
        level: level(),
      };
    },
    getUsage(): TokenUsage {
      return { inputTokens, outputTokens, lastReportedAt };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && node --test --experimental-strip-types tests/chat/token-tracker.test.ts
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/token-tracker.ts ui/tests/chat/token-tracker.test.ts
git commit -m "feat(chat): add token-tracker with soft/hard limits (80K/200K)"
```

---

## Task 2: `prompt.ts` 加 `compact` 形参 + 深度 5→10

**Files:**
- Modify: `ui/src/lib/chat/prompt.ts`
- Modify: `ui/tests/chat/prompt.test.ts`

- [ ] **Step 1: 改 `buildSystemPrompt`**

把现有 `buildSystemPrompt` 签名改成接受第 3 个 `options` 形参。`compact: true` 时去掉 brand code hints 行和 "Tool usage conventions" 的展开（"Bank classification direction rule" 等仍保留——这些是核心规则）。

实现提示：把返回的 string 用一个 helper `buildFullPrompt` 和 `buildCompactPrompt` 分开，函数顶部判断 options。

- [ ] **Step 2: 改测试**

新增 2 个测试：
- `buildSystemPrompt(ctx, tools, { compact: true })` 不含 "gelatomiiix/bonjur/tamkoko store codes" 这行
- `buildSystemPrompt(ctx, tools, { compact: true })` 仍含 `in_amt > 0`、`REV_BIZ` 等核心规则

把 "Don't call more than 5 tools" 改成 "Don't call more than 10 tools"（prompt 中）。

- [ ] **Step 3: 跑测试**

```bash
cd ui && node --test --experimental-strip-types tests/chat/prompt.test.ts
```

Expected: 现有 7 个 + 2 个新 = 9 PASS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/chat/prompt.ts ui/tests/chat/prompt.test.ts
git commit -m "feat(chat): buildSystemPrompt compact mode + depth 5→10"
```

---

## Task 3: `mcp-bridge.ts` 加 `callMcpWithRetry`

**Files:**
- Modify: `ui/src/lib/chat/mcp-bridge.ts`
- Modify: `ui/tests/chat/mcp-bridge.test.ts`

- [ ] **Step 1: 加重试测试**

加 4 个测试到 `mcp-bridge.test.ts`：

```ts
// Add to mcp-bridge.test.ts:
import { callMcpWithRetry } from '../../src/lib/chat/mcp-bridge.ts';

test('callMcpWithRetry returns immediately on success', async () => {
  // Mock global.fetch
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
  }) as typeof fetch;
  const onRetry = () => { throw new Error('should not be called'); };
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x', onRetry, 2,
    );
    assert.equal(calls, 1);
    assert.equal((r as { ok: true; text: string }).text, 'ok');
  } finally { global.fetch = original; }
});

test('callMcpWithRetry retries on 5xx', async () => {
  const original = global.fetch;
  let calls = 0;
  const retries: number[] = [];
  global.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response('boom', { status: 503 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
  }) as typeof fetch;
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x',
      (a) => retries.push(a), 2,
    );
    assert.equal(calls, 2);
    assert.deepEqual(retries, [1]);
    assert.equal((r as { ok: true; text: string }).text, 'ok');
  } finally { global.fetch = original; }
});

test('callMcpWithRetry does NOT retry on 4xx', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return new Response('bad', { status: 400 });
  }) as typeof fetch;
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x',
      () => { throw new Error('should not retry on 4xx'); }, 2,
    );
    assert.equal(calls, 1);
    assert.ok(r instanceof McpCallError);
    assert.equal((r as McpCallError).code, 400);
  } finally { global.fetch = original; }
});

test('callMcpWithRetry gives up after maxAttempts on 5xx', async () => {
  const original = global.fetch;
  let calls = 0;
  const retries: number[] = [];
  global.fetch = (async () => {
    calls++;
    return new Response('boom', { status: 503 });
  }) as typeof fetch;
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x',
      (a) => retries.push(a), 2,
    );
    assert.equal(calls, 2);
    assert.deepEqual(retries, [1]); // only 1 retry (attempt 1 failed, attempt 2 failed)
    assert.ok(r instanceof McpCallError);
  } finally { global.fetch = original; }
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && node --test --experimental-strip-types tests/chat/mcp-bridge.test.ts
```

Expected: 4 new tests FAIL — `callMcpWithRetry` not exported.

- [ ] **Step 3: 实现 `callMcpWithRetry`**

追加到 `mcp-bridge.ts` 末尾：

```ts
/**
 * callMcp with automatic retry on 5xx / network errors.
 * 4xx errors are NOT retried (they're caller errors, retrying won't help).
 *
 * @param onRetry Called BEFORE sleeping to wait for next attempt.
 *                `attempt` is the 1-indexed attempt number that just failed.
 */
export async function callMcpWithRetry(
  request: JsonRpcRequest,
  cookieHeader: string | null,
  baseUrl: string,
  onRetry: (attempt: number, maxAttempts: number, err: McpCallError) => void,
  maxAttempts: number = 2,
): Promise<McpResult> {
  let lastErr: McpCallError | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await callMcp(request, cookieHeader, baseUrl);
    if (!(r instanceof McpCallError)) return r;
    lastErr = r;
    const shouldRetry = r.code >= 500 || r.code < 0; // 5xx or network (negative code)
    if (!shouldRetry) return r;
    if (attempt < maxAttempts) {
      onRetry(attempt, maxAttempts, r);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return lastErr!;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && node --test --experimental-strip-types tests/chat/mcp-bridge.test.ts
```

Expected: 3 (existing) + 4 (new) = 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/mcp-bridge.ts ui/tests/chat/mcp-bridge.test.ts
git commit -m "feat(chat): callMcpWithRetry — auto-retry 5xx/network, 1s gap, max 2"
```

---

## Task 4: SSE event types — thinking_delta, tool_retry, token_warning

**Files:**
- Modify: `ui/src/components/chat/types.ts`

- [ ] **Step 1: 加 3 个新 SseIncoming 变体**

在 `SseIncoming` union 末尾追加：

```ts
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_retry'; id: string; name: string; attempt: number; maxAttempts: number; lastError: string }
  | { type: 'token_warning'; used: number; softLimit: number; level: 'soft' | 'hard' };
```

- [ ] **Step 2: Verify tsc**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 new errors (the changes are additive to a union; ChatWidget/MessageList will need updates, but tsc is OK with unused union arms as long as you don't switch on a value with no default — we'll handle that in Task 5/6).

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/types.ts
git commit -m "feat(chat): add thinking_delta, tool_retry, token_warning SSE events"
```

---

## Task 5: `route.ts` — 集成 token tracker + retry + 3 个新 SSE 事件

**Files:**
- Modify: `ui/src/app/api/chat/route.ts`

- [ ] **Step 1: 加 import**

```ts
import { createTokenTracker } from '@/lib/chat/token-tracker';
import { callMcpWithRetry } from '@/lib/chat/mcp-bridge';
```

- [ ] **Step 2: 在 route handler 顶部初始化 tracker**

```ts
const tokens = createTokenTracker();
let lastTokenLevel: 'normal' | 'soft' | 'hard' = 'normal';
```

- [ ] **Step 3: 替换 `callMcp` 调用**

把现有的：
```ts
const result = await callMcp(
  { jsonrpc: '2.0', id: rpcIdCounter++, method: 'tools/call', params: { name: tb.name, arguments: tb.input as Record<string, unknown> } },
  cookieHeader, baseUrl,
);
```

替换成：
```ts
const result = await callMcpWithRetry(
  { jsonrpc: '2.0', id: rpcIdCounter++, method: 'tools/call', params: { name: tb.name, arguments: tb.input as Record<string, unknown> } },
  cookieHeader, baseUrl,
  (attempt, max, err) => {
    send({ type: 'tool_retry', id: tb.id, name: tb.name, attempt, maxAttempts: max, lastError: err.message });
  },
  2,
);
```

- [ ] **Step 4: 在 client.messages.create 后累加 tokens**

每次循环结束后：
```ts
const t = tokens.record(response.usage.input_tokens, response.usage.output_tokens);
if (t.level === 'soft' && lastTokenLevel === 'normal') {
  send({ type: 'token_warning', used: t.usage.inputTokens + t.usage.outputTokens, softLimit: 80000, level: 'soft' });
}
if (t.level === 'hard') {
  send({ type: 'error', message: '对话超过 token 上限 (200K)，请重置会话后重试' });
  break;
}
lastTokenLevel = t.level;
```

- [ ] **Step 5: 在循环顶部选 system prompt 版本**

```ts
const system = buildSystemPrompt(
  sess.context, tools,
  lastTokenLevel === 'soft' || lastTokenLevel === 'hard' ? { compact: true } : undefined,
);
```

把这行从原"循环外"挪到"循环内"（每轮重新评估）。

- [ ] **Step 6: 调整 `MAX_TOOL_CHAIN_DEPTH`**

把 `const MAX_TOOL_CHAIN_DEPTH = 5;` 改成 `10`。

- [ ] **Step 7: Verify tsc**

```bash
cd ui && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add ui/src/app/api/chat/route.ts
git commit -m "feat(chat): route integrates token-tracker + retry + 3 new SSE events"
```

---

## Task 6: `ChatWidget.tsx` — 处理新 SSE event

**Files:**
- Modify: `ui/src/components/chat/ChatWidget.tsx`

- [ ] **Step 1: 改 `parseSseStream` 的 callback**

加 3 个新分支：

```ts
} else if (evt.type === 'thinking_delta' && typeof evt.text === 'string') {
  setMessages(m => {
    // Append to last assistant_thinking block, or create one
    const copy = m.slice();
    const last = copy[copy.length - 1];
    if (last && last.type === 'thinking') {
      copy[copy.length - 1] = { ...last, content: last.content + evt.text };
    } else {
      copy.push({ type: 'thinking', content: evt.text, ts: Date.now() });
    }
    return copy;
  });
} else if (evt.type === 'tool_retry') {
  setMessages(m => m.map(x =>
    x.type === 'tool_call' && x.call.id === evt.id
      ? { ...x, call: { ...x.call, retry: { attempt: evt.attempt, maxAttempts: evt.maxAttempts, lastError: evt.lastError } } }
      : x,
  ));
} else if (evt.type === 'token_warning') {
  setMessages(m => [...m, { type: 'token_notice', level: evt.level, used: evt.used, softLimit: evt.softLimit, ts: Date.now() }]);
}
```

- [ ] **Step 2: 加新 ChatMessage variant**

在 `types.ts` 的 `ChatMessage` union 追加：
```ts
  | { type: 'thinking';      content: string; ts: number }
  | { type: 'token_notice';  level: 'soft' | 'hard'; used: number; softLimit: number; ts: number };
```

并在 `ToolCallLite` 加 `retry?: { attempt: number; maxAttempts: number; lastError: string }`。

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/ChatWidget.tsx ui/src/components/chat/types.ts
git commit -m "feat(chat): ChatWidget handles thinking_delta, tool_retry, token_warning"
```

---

## Task 7: `MessageList.tsx` — 渲染 thinking 和重试计数

**Files:**
- Modify: `ui/src/components/chat/MessageList.tsx`

- [ ] **Step 1: 加 thinking 渲染**

在 4-分支 `if-else` 链加新分支：

```tsx
if (m.type === 'thinking') {
  return (
    <div key={i} className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-1 text-xs italic text-gray-500">
      💭 {m.content}
    </div>
  );
}
if (m.type === 'token_notice') {
  return (
    <div key={i} className="rounded border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs text-yellow-800">
      ⚠️ Token 用量已达 {m.used} / 软限 {m.softLimit}（{m.level}）— 后续 prompt 已压缩
    </div>
  );
}
```

- [ ] **Step 2: 在 ToolCallBlock 显示重试计数**

在 `ToolCallBlock` 的 `<code>{call.name}</code>` 后追加：
```tsx
{call.retry && (
  <span className="ml-2 text-yellow-600">重试 {call.retry.attempt}/{call.retry.maxAttempts}</span>
)}
```

- [ ] **Step 3: Verify tsc + next build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -10
```

Expected: 0 tsc errors, build success.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/chat/MessageList.tsx
git commit -m "feat(chat): render thinking blocks + retry count + token notice"
```

---

## Task 8: 最终验证

- [ ] **Step 1: 跑所有单测**

```bash
cd ui && node --test --experimental-strip-types tests/chat/*.test.ts
```

Expected: 22 + 5 + 2 + 4 = 33 PASS.

- [ ] **Step 2: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -10
```

Expected: 0 errors, success.

- [ ] **Step 3: Live test (with dev server on 4100)**

1. Login, open chat
2. Ask "上个月 bonjur 旗下所有门店的营收" → 看到 thinking text → 看到 1× get_brand_stores + 3× query_store_report_snapshot tool_call → 看到汇总
3. 故意构造一个会 5xx 的 query（用错误 store_code） → 看到 "重试 1/2" 黄色字 → 仍 5xx → tool_call 显示 ❌
4. 长 session（多问几次）让 token 累加过 80K → 看到 ⚠️ token notice

- [ ] **Step 4: commit any final changes**

```bash
git status
# If any uncommitted, add + commit
```

---

## 验收

- 33/33 单元测试通过
- `tsc --noEmit` 0 新错误
- `next build` 成功
- Live: multi-step agent 工作（≥6 tool 串起来）
- Live: 重试计数 UI 可见
- Live: thinking text 可见
- Live: 80K token notice 触发
