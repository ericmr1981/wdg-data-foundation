# Chat Widget Agent Enhancement Design

## 1. 概述

把当前的 `feat/ai-chat-widget` 升级为**真正的"数据 agent"**。当前已经支持自主调 45 个 MCP 工具（"工具调用 agent"），但缺乏真正的 agent 行为：思考过程不可见、错误不重试、token 不控、子任务不会自己拆解。本期补齐这些能力。

## 2. 范围

### 包含
- **Thinking text**：每个 tool_use 之前插入一句 Claude 生成的简短中文规划（如"先查 bonjur 旗下有哪些门店"），灰色 italic 渲染
- **错误重试**：server 端对 `callMcp` 的 4xx/5xx/timeout 透明重试，最多 2 次，间隔 1s
- **重试计数 UI**：tool_call 折叠块里显示"重试 1/2... 重试 2/2..."
- **Token 软压**：单会话累计 input+output tokens 超过 80K 时，下一次 system prompt 走压缩版（保留核心规则、丢例子、丢品牌代码提示）
- **工具链深度上调**：MAX_TOOL_CHAIN_DEPTH 从 5 调到 10
- **不写权限/UI 拆解/重置按钮/计划面板**：本期不动

### 不包含（一期 YAGNI）
- 独立的"计划面板" UI（你已选"流中插入 thinking text"）
- 跨会话记忆（每会话独立）
- Tool 调用的人工接管（用户中途点"取消本次执行"）
- 真正的"AI 软件工程师"能力（读仓库、改 SQL、git 提交）—— 那要走 Claude Code SDK/CLI 路线，本期不做
- 异步长任务（上传 50MB Excel 后台处理）—— 不在范围

## 3. 架构

```
SSE 路由 (POST /api/chat)
  │
  ├─ runWithTokenTracking({maxInput, maxOutput, softLimit}, ...)
  │   │
  │   └─ Anthropic SDK loop
  │       │
  │       ├─ 收到 thinking text → SSE 'thinking_delta'  ← NEW
  │       │
  │       ├─ 收到 tool_use → SSE 'tool_start'
  │       │
  │       ├─ callMcp (带透明重试 1+2 次)  ← NEW: retry wrapper
  │       │   └─ 失败 → SSE 'tool_retry' 显示重试进度  ← NEW
  │       │
  │       ├─ 失败 → SSE 'tool_end' isError
  │       │
  │       └─ 累计 tokens ≥ 80K → 下次用压缩版 system prompt  ← NEW
  │
  └─ done / error
```

## 4. 组件与数据流

### 4.1 新的 SSE event 类型

| 事件 | 字段 | 用途 |
|---|---|---|
| `thinking_delta` | `{type, text}` | 流式 thinking 文本（灰色 italic 渲染）|
| `tool_retry` | `{type, id, name, attempt, maxAttempts, lastError}` | 显示重试状态（黄色 "重试 1/2..."）|
| `token_warning` | `{type, used, softLimit, level}` | 80K 触发时发一次，UI 可选展示 |

### 4.2 Thinking 提取策略

Anthropic SDK 的 `client.messages.create({...})` 不直接给 "thinking"。**两条路**：

| 方案 | 实现 | 优 | 劣 |
|---|---|---|---|
| (i) Extended thinking | `thinking: {type: 'enabled', budget_tokens: 1024}` | 真实推理链，更准确 | 额外 token 成本（每轮 1K thinking tokens）；需要 Claude 模型支持；返回在 `thinking` 块里 |
| (ii) 指令驱动规划 | prompt 强化："调用工具前先说'我打算 X'，然后调用" | 0 额外成本 | 不可靠，Claude 可能不遵守 |

**采用 (ii)**: 简单、0 成本、prompt 强化即可。在 `buildSystemPrompt` 加规则。

### 4.3 重试实现

`ui/src/lib/chat/mcp-bridge.ts` 的 `callMcp` 包一个 retry wrapper：

```ts
export async function callMcpWithRetry(
  request, cookieHeader, baseUrl,
  onRetry: (attempt, max, err) => void,
  maxAttempts = 2,
): Promise<McpResult> {
  let lastErr: McpResult | null = null;
  for (let i = 1; i <= maxAttempts; i++) {
    const r = await callMcp(request, cookieHeader, baseUrl);
    if (!(r instanceof McpCallError) || r.code >= 500 || r.code < 0 /* network */) {
      if (i > 1) onRetry(i, maxAttempts, lastErr); // 不太可能到这里
      return r;
    }
    lastErr = r;
    if (i < maxAttempts) {
      onRetry(i, maxAttempts, r);
      await sleep(1000);
    }
  }
  return lastErr!;
}
```

**重试哪些错误**：
- `-32603` (fetch 失败、网络错) — ✅ 重试
- HTTP 5xx — ✅ 重试
- HTTP 4xx (除 429) — ❌ 不重试（参数问题，重试无意义）
- 429 — ✅ 重试（429 是临时）
- JSON-RPC `-32602` (Invalid params) — ❌ 不重试
- 其他 -32xxx — ❌ 不重试

更简单：**只重试 5xx 和 fetch/network errors**。4xx 一律不重试。

### 4.4 Token 软压

`ui/src/lib/chat/token-tracker.ts`（新文件）：

```ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  lastReportedAt: number;
}

export const SOFT_LIMIT = 80_000;
export const HARD_LIMIT = 200_000;

export function createTokenTracker(): {
  record(input: number, output: number): { usage: TokenUsage; level: 'normal' | 'soft' | 'hard' };
  getUsage(): TokenUsage;
}
```

SSE 路由每轮 `client.messages.create(...)` 后读 `response.usage`，累加。

buildSystemPrompt 增加 `compact` 形参：

```ts
export function buildSystemPrompt(
  ctx: PageCtx,
  tools: ToolSchemaLite[],
  options?: { compact?: boolean }
): string;
```

`compact: true` 时返回压缩版（保留 5 条核心规则、丢品牌代码提示、丢工具调用示例）。

SSE 路由每次循环：
```
if (tracker.shouldCompact()) system = buildSystemPrompt(..., { compact: true });
else                            system = buildSystemPrompt(..., { compact: false });
```

发 `token_warning` event（仅首次触发时）。

### 4.5 工具链深度

`MAX_TOOL_CHAIN_DEPTH = 10`（从 5）。Prompt 中的"Don't call more than 5 tools"也对应改 10。

## 5. 错误处理

| 失败 | 处理 |
|---|---|
| Thinking text 流中断 | `SseIncoming` 加 `thinking_delta` 类型；前端正常累积 |
| 2 次重试后仍失败 | 正常 `tool_end` with isError=true；Claude 看 tool_result 决定下一步 |
| Token 软压触发 | system prompt 切到 compact 版；用户无感（除非他们看 SSE event log） |
| Token 硬限触发 | SSE `error` "对话超过 token 上限，请重置" |
| 单个 thinking chunk 极长（>5K chars）| 不限制（Claude 负责） |

## 6. 数据与隐私

无变化：聊天仍 in-memory 30 分钟 TTL。

## 7. 速率限制

无变化：60s/10 msg。

## 8. 审计

无变化：ops.chat_session_log / ops.chat_tool_call。

新增：`_token_warnings` 计数（可选）—— 暂不写库，session 内存里记着。

## 9. 测试与验收

### 9.1 单元测试

| 测什么 | 文件 |
|---|---|
| `callMcpWithRetry` 第一次成功 → 不重试 | `mcp-bridge.test.ts` |
| `callMcpWithRetry` 第一次 5xx → 重试 → 第二次成功 | 同上 |
| `callMcpWithRetry` 重试 2 次仍 5xx → 返回最后一次错误 | 同上 |
| `callMcpWithRetry` 4xx → 不重试，立即返回 | 同上 |
| `createTokenTracker().record(50K, 30K).level` === 'normal' | `token-tracker.test.ts` |
| `createTokenTracker().record(60K, 25K).level` === 'soft' | 同上 |
| `createTokenTracker().record(150K, 60K).level` === 'hard' | 同上 |
| `buildSystemPrompt(ctx, tools, { compact: true })` 不含品牌代码行 | `prompt.test.ts` |
| `buildSystemPrompt(ctx, tools, { compact: true })` 含核心 5 条规则 | 同上 |
| `SseIncoming` 新增 `thinking_delta`、`tool_retry`、`token_warning` 类型 | `types.test.ts`（新） |

### 9.2 验收目标

- 22 + 6+ 个新单测全过
- `tsc --noEmit` 0 新错误
- `next build` 成功
- Live: 在 chat 里问 "上个月 bonjur 全部门店的营收" → 看到 thinking text → 看到 tool_call 重试 0 次 → 看到汇总结果
- Live: 问"所有品牌的所有门店的上个月数据" → 多步串起来（get_brand_stores → 3 brand_stores → 6 snapshots）→ 看到 6+ tool_call 块
- Live: 故意构造一个会失败的 query（错误 store_code） → 看到重试 → 失败后 Claude 改问用户

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| thinking text 提示 Claude 每次都写 → token 变多 | prompt 措辞"简短"，并限 tool 链深度 10 |
| 软压后 Claude 不认识品牌代码 | compact 模式只丢**提示**，工具 schema 仍含描述 |
| 重试 2 次 + 5 步 × 4 秒 = 单轮最长 20+ 秒，maxDuration=60 还够 | 监控单轮耗时；超 60s 自动断 |
| `onRetry` callback 在 SSE controller 已 close 后触发 | 用 try/catch 包 send() |

## 11. 文件清单

**新增**（3 个）：
- `ui/src/lib/chat/token-tracker.ts`
- `ui/tests/chat/token-tracker.test.ts`
- `ui/tests/chat/sse-types.test.ts`（type-level 简单测试，可选）

**修改**（约 5 个）：
- `ui/src/lib/chat/mcp-bridge.ts` — 加 `callMcpWithRetry`
- `ui/src/lib/chat/prompt.ts` — 加 `compact` 形参；深度限制从 5 改 10
- `ui/src/lib/chat/stream.ts` — 改 SseEvent 类型定义（如果需要）
- `ui/src/components/chat/types.ts` — 加 `thinking_delta` / `tool_retry` / `token_warning` 到 SseIncoming
- `ui/src/components/chat/MessageList.tsx` — 渲染 thinking_delta（灰色 italic block）
- `ui/src/components/chat/ChatWidget.tsx` — 处理新 SSE event 类型
- `ui/src/app/api/chat/route.ts` — 集成 token tracker + 调用 callMcpWithRetry + 发新 SSE 事件
- `ui/tests/chat/mcp-bridge.test.ts` — 加重试测试
- `ui/tests/chat/prompt.test.ts` — 加 compact 模式测试

## 12. 验收 checklist

- [ ] 22+ 个新单测全过
- [ ] `tsc --noEmit` 0 新错误
- [ ] `next build` 成功
- [ ] Live: 多步 agent 工作（≥6 个 tool 串起来）
- [ ] Live: 重试计数 UI 可见
- [ ] Live: 80K 触发后 system prompt 切到 compact（不容易测；通过 SSE log 观察）
