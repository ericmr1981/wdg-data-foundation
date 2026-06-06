# Agent Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin 能在 Web 上编辑 `agent.md`（自定义 agent 提示词）和调整 7 个调试参数（max_tokens / temperature / 深度 / token 限 / 重试），变更热生效。

**Architecture:** 新增 `agent-config-store` (in-memory) + `agent.md` 默认模板；新 `app/api/admin/agent-config` 端点；新 `app/u/admin/agent-config/page.tsx` 页面（admin-only）。route.ts 和 prompt.ts 改造读 store。

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind, node --test.

---

## File Structure

```
ui/src/lib/chat/
  agent.md                         # NEW: 默认模板（git 跟踪）
  agent-config-store.ts            # NEW: in-memory config + 默认值
  prompt.ts                        # MODIFY: 加 customInstructions 形参
  rate-limit.ts                    # MODIFY: maxPerMinute 改可注入
  token-tracker.ts                 # MODIFY: SOFT/HARD 改可注入
  mcp-bridge.ts                    # MODIFY: maxAttempts 改可注入

ui/src/app/api/admin/agent-config/
  route.ts                         # NEW: GET / POST / DELETE

ui/src/app/u/admin/
  layout.tsx                       # NEW: 鉴权（admin-only）
  agent-config/page.tsx           # NEW: 主页面

ui/src/components/admin/
  AgentConfigEditor.tsx            # NEW: 编辑器 (textarea + 数字输入)
  AgentConfigPreview.tsx           # NEW: prompt 预览

ui/src/app/api/chat/route.ts       # MODIFY: 从 store 读参数
ui/src/app/u/layout.tsx            # MODIFY: 注入 admin 入口 (optional)

ui/tests/chat/
  agent-config-store.test.ts       # NEW
  prompt.test.ts                   # MODIFY: 加 customInstructions 测试
```

---

## Task 1: 默认 agent.md + agent-config-store + 测试

**Files:**
- Create: `ui/src/lib/chat/agent.md`
- Create: `ui/src/lib/chat/agent-config-store.ts`
- Create: `ui/tests/chat/agent-config-store.test.ts`

- [ ] **Step 1: 写默认 agent.md**

```md
# 项目级 Agent 指令

（本文件由管理员通过 /u/admin/agent-config 编辑。修改后下一个请求即生效。）

> 这里的内容会被拼到 system prompt 的通用规则**之前**，作为 "Custom Instructions" 段。
> 你可以加：业务术语定义、用户偏好、回答风格、特定场景的指引。
> 通用规则 / 借贷方向 / 禁用工具等核心段仍由代码控制，**不要**在此覆盖。

## 业务术语

- 「上月」= Today 减去 1 个月
- 「同期」= 去年同月
- 蜜可诗 = brand_gelatomiiix

## 回答风格

- 始终用中文回答
- 数字四舍五入到万元
- 不主动展开未问的指标

## 调试说明

- 模型：claude-opus-4-8（或代理覆盖）
- 工具深度：默认 10，可调
- 重试：默认 2 次
```

Commit: `feat(chat): default agent.md template`

- [ ] **Step 2: 写 store**

```ts
// ui/src/lib/chat/agent-config-store.ts
import { readFileSync } from 'fs';
import { join } from 'path';

export interface AgentConfigParams {
  maxTokens: number;
  temperature: number;
  topP: number | null;
  maxToolChainDepth: number;
  rateLimitMaxPerMinute: number;
  tokenSoftLimit: number;
  tokenHardLimit: number;
  mcpRetryMaxAttempts: number;
}

export interface AgentConfig {
  agentMd: string;
  params: AgentConfigParams;
}

export const DEFAULT_PARAMS: AgentConfigParams = {
  maxTokens: 4096,
  temperature: 0.3,
  topP: null,
  maxToolChainDepth: 10,
  rateLimitMaxPerMinute: 10,
  tokenSoftLimit: 80_000,
  tokenHardLimit: 200_000,
  mcpRetryMaxAttempts: 2,
};

const AGENT_MD_PATH = join(process.cwd(), 'ui', 'src', 'lib', 'chat', 'agent.md');

function loadDefaultAgentMd(): string {
  try {
    return readFileSync(AGENT_MD_PATH, 'utf-8');
  } catch {
    return '# 项目级 Agent 指令\n\n（默认 agent.md 加载失败）\n';
  }
}

let current: AgentConfig = {
  agentMd: loadDefaultAgentMd(),
  params: { ...DEFAULT_PARAMS },
};

export function getAgentConfig(): AgentConfig {
  return current;
}

export function setAgentMd(content: string): void {
  current = { ...current, agentMd: content };
}

export function setParam<K extends keyof AgentConfigParams>(
  key: K,
  value: AgentConfigParams[K],
): void {
  current = { ...current, params: { ...current.params, [key]: value } };
}

export function setParams(params: Partial<AgentConfigParams>): void {
  current = { ...current, params: { ...current.params, ...params } };
}

export function resetAgentConfig(): void {
  current = {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
  };
}

export const AGENT_MD_FILE_PATH = AGENT_MD_PATH;
```

- [ ] **Step 3: 写测试（5 个）**

```ts
// ui/tests/chat/agent-config-store.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import {
  getAgentConfig, setAgentMd, setParam, setParams, resetAgentConfig,
  DEFAULT_PARAMS,
} from '../../src/lib/chat/agent-config-store.ts';

test('initial state has default params and loaded agent.md', () => {
  resetAgentConfig();
  const c = getAgentConfig();
  assert.deepEqual(c.params, DEFAULT_PARAMS);
  assert.ok(c.agentMd.length > 0);
  assert.match(c.agentMd, /项目级 Agent 指令/);
});

test('setAgentMd updates content', () => {
  resetAgentConfig();
  setAgentMd('# Custom content');
  assert.equal(getAgentConfig().agentMd, '# Custom content');
});

test('setParam updates a single field', () => {
  resetAgentConfig();
  setParam('maxTokens', 1024);
  assert.equal(getAgentConfig().params.maxTokens, 1024);
  assert.equal(getAgentConfig().params.temperature, 0.3); // other fields unchanged
});

test('setParams updates multiple fields', () => {
  resetAgentConfig();
  setParams({ temperature: 0.7, maxToolChainDepth: 15 });
  const p = getAgentConfig().params;
  assert.equal(p.temperature, 0.7);
  assert.equal(p.maxToolChainDepth, 15);
  assert.equal(p.maxTokens, 4096); // unchanged
});

test('resetAgentConfig returns to defaults', () => {
  setAgentMd('# temporary');
  setParam('maxTokens', 999);
  resetAgentConfig();
  const c = getAgentConfig();
  assert.equal(c.params.maxTokens, 4096);
  assert.match(c.agentMd, /项目级 Agent 指令/);
});
```

- [ ] **Step 4: tsc + tests**

```bash
cd ui && npx tsc --noEmit && node --test --experimental-strip-types tests/chat/agent-config-store.test.ts
```

Expected: 0 tsc errors, 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/agent.md ui/src/lib/chat/agent-config-store.ts ui/tests/chat/agent-config-store.test.ts
git commit -m "feat(chat): default agent.md template + in-memory config store"
```

---

## Task 2: prompt.ts + token/rate/mcp-bridge 改造支持注入

**Files:**
- Modify: `ui/src/lib/chat/prompt.ts` — 加 `customInstructions` 形参
- Modify: `ui/src/lib/chat/token-tracker.ts` — SOFT/HARD 改可注入
- Modify: `ui/src/lib/chat/rate-limit.ts` — max 改可注入
- Modify: `ui/src/lib/chat/mcp-bridge.ts` — `callMcpWithRetry` 接受 maxAttempts 形参
- Modify: `ui/tests/chat/prompt.test.ts` — 加 customInstructions 测试

- [ ] **Step 1: 改 prompt.ts**

`buildSystemPrompt` 加第 4 个形参 `customInstructions?: string`。在 `buildFullPrompt` 和 `buildCompactPrompt` 头部 `buildHeader` 之后插入 "Custom Instructions:" 段（如果 customInstructions 非空）。

```ts
function buildFullPrompt(ctx, tools, customInstructions?: string): string {
  const header = buildHeader(ctx, tools);
  const custom = customInstructions?.trim()
    ? `\n\nCustom Instructions (from agent.md):\n${customInstructions.trim()}\n`
    : '';
  return `${header}${custom}\n\n${GENERAL_RULES_FULL}\n\n${TOOL_USAGE_CONVENTIONS}\n\n${BANK_RULE}\n\n${FORBIDDEN}`;
}
// Same for buildCompactPrompt (custom instructions are CORE, not stripped)
```

主函数签名：`buildSystemPrompt(ctx, tools, options?: BuildOptions)`。在 `BuildOptions` 加 `customInstructions?: string`。

- [ ] **Step 2: 加 prompt 测试**

```ts
test('buildSystemPrompt includes customInstructions from agent.md', () => {
  const out = buildSystemPrompt({}, baseTools, { customInstructions: '# My custom rules' });
  assert.match(out, /Custom Instructions \(from agent\.md\)/);
  assert.match(out, /# My custom rules/);
});

test('buildSystemPrompt compact mode keeps customInstructions', () => {
  const out = buildSystemPrompt({}, baseTools, { compact: true, customInstructions: '# Always' });
  assert.match(out, /# Always/);
});

test('buildSystemPrompt without customInstructions omits the section', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.doesNotMatch(out, /Custom Instructions/);
});
```

- [ ] **Step 3: 改 token-tracker.ts**

把 `SOFT_LIMIT` 和 `HARD_LIMIT` 从 const 改成 `let`，加 setter：

```ts
export let SOFT_LIMIT = 80_000;
export let HARD_LIMIT = 200_000;
export function setTokenLimits(soft: number, hard: number): void {
  SOFT_LIMIT = soft;
  HARD_LIMIT = hard;
}
```

`createTokenTracker` 内部读这两个变量（在 record 时通过 `level()` 函数读）。

注意：node --test 跑过的话，模块级 let 会被 hoist。**这里我们用函数闭包而不是模块级 let** 更稳妥：

```ts
let softLimit = 80_000;
let hardLimit = 200_000;
export function getTokenLimits() { return { soft: softLimit, hard: hardLimit }; }
export function setTokenLimits(soft: number, hard: number) { softLimit = soft; hardLimit = hard; }
```

`createTokenTracker` 改成 `getTokenLimits()`。

**CRITICAL**: 现有 token-tracker.test.ts 用的 80_000/200_000 数字断言。如果改实现，测试可能要微调——但 80K/200K 默认值不变，测试应该通过。

- [ ] **Step 4: 改 rate-limit.ts**

把 `MAX` 从 const 改成 `let`，加 setter：

```ts
let max = 10;
export function getRateLimitMax() { return max; }
export function setRateLimitMax(n: number) { max = n; }
```

`checkRateLimit` 用 `getRateLimitMax()` 替代 `MAX`。

- [ ] **Step 5: 改 mcp-bridge.ts**

`callMcpWithRetry` 当前的 `maxAttempts` 已经是形参（默认值 2）。**OK 不动**。但 route.ts 需要传 `cfg.params.mcpRetryMaxAttempts`。

- [ ] **Step 6: tsc + tests**

```bash
cd ui && npx tsc --noEmit && node --test --experimental-strip-types tests/chat/*.test.ts
```

Expected: 0 tsc errors, all 40+ tests pass (35 + 5 new = 40).

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/chat/prompt.ts ui/src/lib/chat/token-tracker.ts ui/src/lib/chat/rate-limit.ts ui/tests/chat/prompt.test.ts
git commit -m "feat(chat): prompt/token/rate accept injected config from agent-config-store"
```

---

## Task 3: route.ts 集成 store

**Files:**
- Modify: `ui/src/app/api/chat/route.ts`

- [ ] **Step 1: 改 import + 读 store**

```ts
import { getAgentConfig, setTokenLimits, setRateLimitMax } from '@/lib/chat/...';
// or single import:
import { getAgentConfig, applyConfigToGlobals } from '@/lib/chat/agent-config-store';
```

**更优雅做法**：在 `agent-config-store.ts` 加 `applyConfigToGlobals()` 函数，把 store 里的参数推到 token-tracker / rate-limit 的模块级状态。route.ts 启动时调一次。

```ts
// agent-config-store.ts (append)
export function applyConfigToGlobals(): void {
  const p = current.params;
  setTokenLimits(p.tokenSoftLimit, p.tokenHardLimit);
  setRateLimitMax(p.rateLimitMaxPerMinute);
}
```

route.ts 在第 4 步之前调一次 `applyConfigToGlobals()`。

- [ ] **Step 2: 改 buildSystemPrompt 调用**

```ts
const cfg = getAgentConfig();
const system = buildSystemPrompt(
  sess.context, tools,
  {
    customInstructions: cfg.agentMd,
    compact: lastTokenLevel === 'soft' || lastTokenLevel === 'hard',
  },
);
```

- [ ] **Step 3: 改 client.messages.create**

```ts
const response = await client.messages.create({
  model: anthropicModel,
  system,
  tools: tools as Anthropic.Tool[],
  messages: runningMessages,
  max_tokens: cfg.params.maxTokens,
  temperature: cfg.params.temperature,
  ...(cfg.params.topP != null ? { top_p: cfg.params.topP } : {}),
});
```

- [ ] **Step 4: 改 MAX_TOOL_CHAIN_DEPTH 引用**

替换 `MAX_TOOL_CHAIN_DEPTH` 为 `cfg.params.maxToolChainDepth`。

- [ ] **Step 5: 改 callMcpWithRetry 的 maxAttempts**

替换 `2` 为 `cfg.params.mcpRetryMaxAttempts`。

- [ ] **Step 6: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

Expected: 0 tsc errors, build success.

- [ ] **Step 7: Commit**

```bash
git add ui/src/app/api/chat/route.ts ui/src/lib/chat/agent-config-store.ts
git commit -m "feat(chat): route.ts reads runtime config (maxTokens/temperature/depth/retries)"
```

---

## Task 4: API 端点

**Files:**
- Create: `ui/src/app/api/admin/agent-config/route.ts`

- [ ] **Step 1: 实现 GET / POST / DELETE**

```ts
// ui/src/app/api/admin/agent-config/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { getSessionUser } from '@/lib/auth-server';
import {
  getAgentConfig, setAgentMd, setParams, resetAgentConfig,
  applyConfigToGlobals, AGENT_MD_FILE_PATH, DEFAULT_PARAMS,
} from '@/lib/chat/agent-config-store';

export const runtime = 'nodejs';

const VALID_KEYS = new Set(Object.keys(DEFAULT_PARAMS));

function isAdmin(user: { role: string } | null): boolean {
  return user?.role === 'admin';
}

export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const cfg = getAgentConfig();
  return NextResponse.json({
    agentMd: cfg.agentMd,
    params: cfg.params,
    defaultParams: DEFAULT_PARAMS,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.agentMd === 'string') {
    setAgentMd(body.agentMd);
    try { writeFileSync(AGENT_MD_FILE_PATH, body.agentMd, 'utf-8'); } catch { /* in-memory only */ }
  }
  if (body.params && typeof body.params === 'object') {
    const validated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.params)) {
      if (!VALID_KEYS.has(k)) continue;
      validated[k] = v;
    }
    setParams(validated as any);
  }
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  resetAgentConfig();
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}
```

- [ ] **Step 2: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -4
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/app/api/admin/agent-config/route.ts
git commit -m "feat(chat): GET/POST/DELETE /api/admin/agent-config (admin-only)"
```

---

## Task 5: admin layout 鉴权

**Files:**
- Create: `ui/src/app/u/admin/layout.tsx`

- [ ] **Step 1: 实现 admin layout**

```tsx
// ui/src/app/u/admin/layout.tsx
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth-server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/u/admin/agent-config');
  if (user.role !== 'admin') {
    return (
      <div className="m-8 rounded border border-red-200 bg-red-50 p-4 text-red-800">
        <h2 className="text-lg font-semibold">403 — 需要 admin 权限</h2>
        <p>当前角色：{user.role}。请联系管理员申请权限。</p>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/app/u/admin/layout.tsx
git commit -m "feat(chat): /u/admin/* layout with admin role check (403 for non-admin)"
```

---

## Task 6: 编辑器组件 + 页面

**Files:**
- Create: `ui/src/components/admin/AgentConfigEditor.tsx`
- Create: `ui/src/components/admin/AgentConfigPreview.tsx`
- Create: `ui/src/app/u/admin/agent-config/page.tsx`

- [ ] **Step 1: 实现 AgentConfigEditor.tsx**

```tsx
'use client';
import { useState } from 'react';
import type { AgentConfigParams } from '@/lib/chat/agent-config-store';

interface Props {
  initial: { agentMd: string; params: AgentConfigParams };
  defaultParams: AgentConfigParams;
  onSave: (data: { agentMd: string; params: AgentConfigParams }) => Promise<void>;
  onReset: () => Promise<void>;
}

const PARAM_META: Array<{ key: keyof AgentConfigParams; label: string; min: number; max: number; step: number; help: string }> = [
  { key: 'maxTokens',            label: 'max_tokens (Anthropic)', min: 256, max: 16384, step: 256,  help: '单次响应的最大 token 数' },
  { key: 'temperature',          label: 'temperature',              min: 0,   max: 1,     step: 0.1,  help: '0=精确, 1=发散' },
  { key: 'topP',                 label: 'top_p (留空=用默认)',       min: 0,   max: 1,     step: 0.1,  help: '可选。nucleus sampling 阈值' },
  { key: 'maxToolChainDepth',    label: '工具调用深度',              min: 1,   max: 20,    step: 1,    help: '单会话最多连续调几次 MCP 工具' },
  { key: 'rateLimitMaxPerMinute',label: '60s 内最多消息数',          min: 1,   max: 100,   step: 1,    help: '限流阈值' },
  { key: 'tokenSoftLimit',       label: 'Token 软限 (compact 触发)', min: 10000, max: 200000, step: 5000, help: '超过则切到 compact prompt' },
  { key: 'tokenHardLimit',       label: 'Token 硬限 (报错)',          min: 50000, max: 500000, step: 10000, help: '超过则终止会话' },
  { key: 'mcpRetryMaxAttempts',  label: 'MCP 重试次数 (5xx)',       min: 1,   max: 5,     step: 1,    help: '最大重试次数 (含首次)' },
];

export function AgentConfigEditor({ initial, defaultParams, onSave, onReset }: Props) {
  const [agentMd, setAgentMd] = useState(initial.agentMd);
  const [params, setParams] = useState<AgentConfigParams>(initial.params);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = agentMd !== initial.agentMd ||
    (Object.keys(params) as Array<keyof AgentConfigParams>).some(k => params[k] !== initial.params[k]);

  function updateParam<K extends keyof AgentConfigParams>(k: K, v: number | null) {
    setParams(p => ({ ...p, [k]: v }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ agentMd, params });
      setMessage('✅ 已保存。下个请求即生效。');
    } catch (e) {
      setMessage('❌ 保存失败：' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('确定重置为默认值？')) return;
    setSaving(true);
    try {
      await onReset();
      setMessage('✅ 已重置。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <label className="block text-sm font-semibold text-gray-700">agent.md 内容</label>
        <p className="mt-1 text-xs text-gray-500">会被拼到 system prompt 的通用规则**之前**。下一个请求即生效。</p>
        <textarea
          value={agentMd}
          onChange={e => setAgentMd(e.target.value)}
          rows={20}
          className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
        />
        <div className="mt-1 text-right text-xs text-gray-500">{agentMd.length} 字符</div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">调试参数</h3>
        <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
          {PARAM_META.map(m => (
            <div key={m.key}>
              <label className="block text-xs text-gray-600">{m.label}</label>
              <input
                type="number"
                min={m.min}
                max={m.max}
                step={m.step}
                value={params[m.key] == null ? '' : String(params[m.key])}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '' && m.key === 'topP') {
                    updateParam(m.key, null);
                  } else {
                    const n = Number(v);
                    if (!Number.isNaN(n)) updateParam(m.key, n);
                  }
                }}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <p className="mt-1 text-[10px] text-gray-400">{m.help} (默认: {String(defaultParams[m.key])})</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          重置默认
        </button>
        {message && <span className="text-sm text-gray-700">{message}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 实现 AgentConfigPreview.tsx**

```tsx
'use client';
import { useState, useEffect } from 'react';
import { buildSystemPrompt } from '@/lib/chat/prompt';

export function AgentConfigPreview({ agentMd }: { agentMd: string }) {
  const [preview, setPreview] = useState('');

  useEffect(() => {
    const sampleTools = [
      { name: 'get_brand_stores', description: 'sample', input_schema: {} },
    ];
    try {
      const p = buildSystemPrompt({}, sampleTools as any, { customInstructions: agentMd });
      setPreview(p.slice(0, 3000) + (p.length > 3000 ? '\n\n... (截断显示)' : ''));
    } catch (e) {
      setPreview('预览失败: ' + (e as Error).message);
    }
  }, [agentMd]);

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">预览拼出的 system prompt（前 3000 字符）</summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs">{preview}</pre>
    </details>
  );
}
```

- [ ] **Step 3: 实现 page.tsx**

```tsx
// ui/src/app/u/admin/agent-config/page.tsx
import { getSessionUser } from '@/lib/auth-server';
import { getAgentConfig, DEFAULT_PARAMS } from '@/lib/chat/agent-config-store';
import { AgentConfigEditor } from '@/components/admin/AgentConfigEditor';
import { AgentConfigPreview } from '@/components/admin/AgentConfigPreview';

export const dynamic = 'force-dynamic';

async function saveConfig(data: { agentMd: string; params: typeof DEFAULT_PARAMS }) {
  'use server';
  // ... server action that calls the API
}

export default async function AgentConfigPage() {
  const cfg = getAgentConfig();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Agent 配置 (Admin)</h1>
        <p className="text-xs text-gray-500">编辑 agent.md 自定义提示词 · 调整调试参数 · 变更热生效</p>
      </header>
      <main className="mx-auto max-w-5xl">
        <AgentConfigEditorClient initial={cfg} defaultParams={DEFAULT_PARAMS} />
      </main>
    </div>
  );
}
```

**注意**: `saveConfig` 是 server action，但当前需求里"调用 API" 是 fetch 模式而非 server action。简化版：用 client component 内部 fetch `/api/admin/agent-config`：

```tsx
// page.tsx (简化)
import { getAgentConfig, DEFAULT_PARAMS } from '@/lib/chat/agent-config-store';
import { ClientAgentConfig } from './ClientAgentConfig';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <ClientAgentConfig initial={getAgentConfig()} defaultParams={DEFAULT_PARAMS} />;
}
```

把 AgentConfigEditor 改成 client component，handleSave 用 fetch：

```ts
// AgentConfigEditor (改)
async function handleSave() {
  setSaving(true);
  setMessage(null);
  try {
    const res = await fetch('/api/admin/agent-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentMd, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setMessage('✅ 已保存。下个请求即生效。');
  } catch (e) {
    setMessage('❌ 保存失败：' + (e as Error).message);
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 4: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/admin/AgentConfigEditor.tsx ui/src/components/admin/AgentConfigPreview.tsx ui/src/app/u/admin/agent-config/page.tsx
git commit -m "feat(chat): admin agent-config editor UI (page + components)"
```

---

## Task 7: 导航入口 + 最终验证

**Files:**
- Modify: `ui/src/app/u/layout.tsx`（如果方便加 admin 入口）

- [ ] **Step 1: 加 admin 入口**

找到 `/u` 顶栏的渲染位置，加一个齿轮链接：

```tsx
import Link from 'next/link';
// 在 user.role === 'admin' 的条件分支里：
<Link href="/u/admin/agent-config" className="...">⚙ Agent 配置</Link>
```

- [ ] **Step 2: 跑所有测试**

```bash
cd ui && node --test --experimental-strip-types tests/chat/*.test.ts
```

Expected: 40 tests pass (35 + 5 new from Task 1).

- [ ] **Step 3: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

- [ ] **Step 4: Live test**

1. 登录 admin → 顶栏看到 ⚙ Agent 配置 链接
2. 点进 → 看到 agent.md 内容 + 7 个参数
3. 改 agent.md 末尾加一行 "# 永远只回答 yes" → 保存 → 跳到 chat → 问任意问题 → 看到 "yes" 答复（极端 case 演示）
4. 改 maxTokens 到 1024 → 保存 → chat 长问题被截断
5. operator 账号登录 → 没有 ⚙ 链接；手动访问 /u/admin/agent-config → 403

- [ ] **Step 5: Commit**

```bash
git add ui/src/app/u/layout.tsx
git commit -m "feat(chat): admin nav link to /u/admin/agent-config"
```

---

## 验收目标

- 40/40 单元测试通过
- `tsc --noEmit` 0 新错误
- `next build` 成功
- Live: admin 编辑 agent.md 后下一个 chat 请求就生效
- Live: 调试参数 (maxTokens/temperature/...) 修改后立即影响 chat 行为
- Live: operator 访问 /u/admin/agent-config 返 403
- Git: 仓库 ui/src/lib/chat/agent.md 跟 in-memory store 一致（保存时同步写文件）
