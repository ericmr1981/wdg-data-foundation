# Spec A — Chat ↔ Agent 通讯(Agent 服务侧)

> 给 Agent 服务开发者(`wdg-data-foundation/agent`,监听 4101 HTTP + 4102 WS)
> 与 [spec-chat-portal.md](../WGD_Portal/docs/spec-chat-portal.md) 对齐使用
> 父计划:[chat-refactor-plan.md](./chat-refactor-plan.md)

---

## A.1 范围

Agent 服务负责:
- 维护 Anthropic SDK 调用正确性(`@anthropic-ai/sdk` 升 `^0.110+`)
- 把 SDK 原始输出**原样透传**到 Portal WS 连接(不再造 envelope)
- 接受 Portal 标准事件(`user.message` / `user.interrupt` / `ping`)
- 暴露历史事件查询接口(断线续传)
- 暴露文件上传接口(独立,不污染 LLM content)

---

## A.2 SDK 用法硬约束

### A.2.1 模型调用必须项

```ts
// 必传
- model: string                       // 来自 agent.config
- max_tokens: number                  // 来自 agent.config,建议 ≤ 64000
- messages: MessageParam[]
- tools?: Tool[]                      // mcpBridge.listTools() + memory + load_skill
- system: string | TextBlockParam[]   // 必须用数组,第一条挂 cache_control
- stream: true                        // 必须

// 必排除(新模型 400)
- temperature, top_p, top_k
- thinking: { type: 'enabled', budget_tokens: N }
- thinking: { type: 'disabled' }      // 不传这个字段,默认就是无 thinking

// 可选
- thinking: { type: 'adaptive' }                                  // 当 thinkingLevel != 'off'
- output_config: { effort: 'low' | 'medium' | 'high' }            // 与 adaptive 配套
- metadata: { user_id: '...' }                                    // 日志追踪
- context_management: { edits: [{ type: 'compact_20260112' }] }   // 阶段 3 启用
- betas: ['compact-2026-01-12']                                   // 阶段 3 启用
```

### A.2.2 Agent loop 用 Tool Runner

```ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey, baseURL })

const toolRunner = anthropic.beta.messages.toolRunner({
  model: cfg.model,
  max_tokens: cfg.params.maxTokens,
  system: buildSystemBlocks(agentMd),   // TextBlockParam[],第一条挂 cache_control
  tools: [
    ...mcpTools,
    { type: 'memory_20250818', name: 'memory' },
    loadSkillTool,                          // 自定义,标准 input_schema
  ],
  messages,
  stream: true,
  ...(thinkingConfigFor(cfg.params.thinkingLevel)),  // 产出 adaptive + effort
})
```

### A.2.3 流式推送 — 原始事件透传

每收到一个 SDK 事件,**完整 envelope 透传**,**不造新字段**:

```ts
for await (const message of toolRunner) {
  // message 是 SDK 的 Message 对象,含 content 数组 + stop_reason + usage
  await ws.send(JSON.stringify({
    type: 'message',
    payload: {
      id: message.id,
      role: message.role,
      stop_reason: message.stop_reason,
      stop_details: message.stop_details,
      content: message.content,            // 完整 content 数组(text/thinking/tool_use)
      usage: message.usage,
      model: message.model,
    },
  }))
}

// streaming 模式 — 每条 stream 事件透传:
// event.message_start           → {type: 'message_start', payload: {message: {...}}}
// event.content_block_start     → {type: 'content_block_start', payload: {index, content_block}}
// event.content_block_delta     → {type: 'content_block_delta', payload: {index, delta}}
// event.content_block_stop      → {type: 'content_block_stop', payload: {index}}
// event.message_delta           → {type: 'message_delta', payload: {delta:{stop_reason}, usage}}
// event.message_stop            → {type: 'message_stop', payload: {}}
```

> **关键**:Agent 不再自己拼 `task_update` / `task_done` / `system_error`。所有前端可见的事件都从 SDK 原始事件来。

### A.2.4 用户消息的 ack

收到 `user.message` 后**立即**回 ack(不超过 200ms):

```ts
ws.on('message', async (raw) => {
  const data = JSON.parse(raw.toString())
  if (data.type === 'user.message') {
    await ws.send(JSON.stringify({
      type: 'ack',
      payload: { messageId: data.payload.messageId, ts: Date.now() },
    }))
    await handleUserMessage(data.payload)
  }
})
```

### A.2.5 错误分类 — SDK typed exception

```ts
import Anthropic from '@anthropic-ai/sdk'

try {
  const stream = anthropic.messages.stream({ ... })
  for await (const event of stream) {
    await ws.send(JSON.stringify(mapStreamEvent(event)))
  }
} catch (e) {
  if (e instanceof Anthropic.RateLimitError) {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: {
        code: 'rate_limit', http_status: 429,
        retry_after_ms: parseRetryAfter(e.headers?.['retry-after']),
        message: '请求频率超限,稍后重试',
      },
    }))
  } else if (e instanceof Anthropic.AuthenticationError) {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: { code: 'auth', http_status: 401, message: 'API key 无效' },
    }))
  } else if (e instanceof Anthropic.PermissionDeniedError) {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: { code: 'permission', http_status: 403, message: '无权访问该模型' },
    }))
  } else if (e instanceof Anthropic.NotFoundError) {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: { code: 'not_found', http_status: 404, message: '模型不存在' },
    }))
  } else if (e instanceof Anthropic.APIConnectionError) {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: { code: 'network', http_status: 0, message: '网络连接失败' },
    }))
  } else if (e instanceof Anthropic.BadRequestError) {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: { code: 'bad_request', http_status: 400, message: e.message },
    }))
  } else {
    await ws.send(JSON.stringify({
      type: 'error',
      payload: { code: 'unknown', http_status: 500, message: '内部错误' },
    }))
  }
}
```

`stop_reason === 'refusal'` 单独处理(不算网络错误):

```ts
if (message.stop_reason === 'refusal') {
  await ws.send(JSON.stringify({
    type: 'error',
    payload: {
      code: 'refusal',
      http_status: 200,
      category: message.stop_details?.category,   // 'cyber' | 'bio' | 'reasoning_extraction' | 'frontier_llm' | null
      message: '请求被拒绝',
    },
  }))
}
```

### A.2.6 Stop reason 处理矩阵

| `stop_reason` | Agent 行为 |
|---|---|
| `end_turn` | 正常发 `message_stop`,关闭 stream |
| `tool_use` | Tool Runner 自动执行 tool,递归继续(不发 error) |
| `max_tokens` | 透传 `message_delta`(前端看到 `usage.output_tokens = max_tokens`);发 `message_stop` 后可选择继续 |
| `refusal` | 单独发 `error { code: 'refusal' }`,**不**写 assistant message 入库 |
| `pause_turn` | Tool Runner 自动恢复,不需 Agent 干预 |
| `model_context_window_exceeded` | 发 `error { code: 'context_overflow' }`,前端提示开启新会话 |

### A.2.7 取消生成

```ts
// WebChannel 收到 user.interrupt
ws.on('message', async (raw) => {
  const data = JSON.parse(raw.toString())
  if (data.type === 'user.interrupt') {
    const inflight = inflightCalls.get(data.payload.conversationId)
    if (inflight?.abortController) {
      inflight.abortController.abort()
      await ws.send(JSON.stringify({
        type: 'interrupted',
        payload: { conversationId: data.payload.conversationId, reason: data.payload.reason || 'user' },
      }))
    }
  }
})

// 启动 LLM 时绑定
const abortController = new AbortController()
inflightCalls.set(conversationId, { abortController })

const stream = anthropic.messages.stream(
  { ... },
  { signal: abortController.signal },   // SDK 0.110+ 支持
)
```

### A.2.8 Prompt caching

`buildSystemPrompt` 改返回**数组**(不是字符串),稳定内容挂 `cache_control`:

```ts
import type Anthropic from '@anthropic-ai/sdk'

const AGENT_MD_CACHE_CONTROL: Anthropic.CacheControlEphemeral = {
  type: 'ephemeral',
  ttl: '1h',
}

export function buildSystemBlocks(agentMd: string): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text: agentMd,
      cache_control: AGENT_MD_CACHE_CONTROL,
    },
  ]
}

// 动态内容(today / brand / 当前会话)不放 system,放进第一条 user message
export function buildSessionContextMessage(ctx: {
  today: string; brand: string | null; conversationId: string; channel: string
}): string {
  return `# Session Context (auto-injected, do not mention to user)
today: ${ctx.today}
brand: ${ctx.brand ?? '<none>'}
channel: ${ctx.channel}
conversationId: ${ctx.conversationId}
`
}
```

### A.2.9 长会话 — 服务端 compaction(阶段 3)

替换 `ConversationManager.maybeCompress` 手写窗口,使用 SDK `compact-2026-01-12` beta:

```ts
const toolRunner = anthropic.beta.messages.toolRunner({
  model: cfg.model,
  max_tokens: 64000,
  system: buildSystemBlocks(agentMd),
  tools,
  messages,
  betas: ['compact-2026-01-12'],
  context_management: { edits: [{ type: 'compact_20260112' }] },
  stream: true,
})

// Agent 收到 compaction block 后:
// 1. 整段 content 回传(包含 compaction block)
// 2. 前端能识别并标记"已压缩"
```

⚠️ **不要**用自实现的 `delete old + insert summary`,会破坏 tool_use_id 链。

---

## A.3 WS 协议(Agent → Portal)

### A.3.1 握手(必发)

```json
{ "type": "hello", "payload": { "protocolVersion": 1, "sessionId": "user-uuid" } }
```

连接建立后立即发。Portal 据此判定走哪条解析路径。详见 [spec-chat-portal.md §B.3](../WGD_Portal/docs/spec-chat-portal.md#b3-ws-协议portal-接收)。

### A.3.2 帧类型清单

| `type` | 触发时机 | 必需字段 | 说明 |
|---|---|---|---|
| `hello` | WS 连接建立后立即发 | `protocolVersion`, `sessionId` | 握手 |
| `ack` | 收到 `user.message` 后立即回 | `messageId`, `ts` | 客户端把临时 id 替换成服务端 ack id |
| `message_start` | SDK 流首事件 | `message.id`, `message.model`, `message.usage` | 流开始 |
| `content_block_start` | SDK 流事件 | `index`, `content_block` (`type: 'text' \| 'thinking' \| 'tool_use' \| ...`) | 内容块开始 |
| `content_block_delta` | SDK 流事件 | `index`, `delta` | 增量(`text_delta` / `thinking_delta` / `input_json_delta`) |
| `content_block_stop` | SDK 流事件 | `index` | 内容块结束 |
| `message_delta` | SDK 流事件 | `delta: { stop_reason, stop_sequence? }`, `usage` | message 级更新 |
| `message_stop` | SDK 流尾事件 | (空 payload) | 流结束 |
| `message` | 非流式调用 | 完整 `Anthropic.Message` | toolRunner yield 出来的最终 message |
| `error` | 异常或 `stop_reason='refusal'` | `code`, `http_status`, `message`, `category?`, `retry_after_ms?` | 错误 |
| `interrupted` | 收到 `user.interrupt` | `conversationId`, `reason` | 取消确认 |
| `ping` / `pong` | 心跳 | `ts` | keepalive |

### A.3.3 完整 envelope 示例

```json
// 握手
{ "type": "hello", "payload": { "protocolVersion": 1, "sessionId": "user-uuid" } }

// ack(收到用户消息)
{ "type": "ack", "payload": { "messageId": "msg_user_01ABC", "ts": 1720000000000 } }

// 流开始
{ "type": "message_start", "payload": {
  "message": {
    "id": "msg_01XYZ",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-4-8",
    "content": [],
    "stop_reason": null,
    "usage": { "input_tokens": 1234, "output_tokens": 0, "cache_creation_input_tokens": 500, "cache_read_input_tokens": 8000 }
  }
}}

// 文本块
{ "type": "content_block_start", "payload": { "index": 0, "content_block": { "type": "text", "text": "" }}}
{ "type": "content_block_delta", "payload": { "index": 0, "delta": { "type": "text_delta", "text": "本" }}}
{ "type": "content_block_delta", "payload": { "index": 0, "delta": { "type": "text_delta", "text": "月营收" }}}
{ "type": "content_block_stop", "payload": { "index": 0 }}

// 工具块(可选)
{ "type": "content_block_start", "payload": { "index": 1, "content_block": { "type": "tool_use", "id": "toolu_01ABC", "name": "query_db", "input": {} }}}
{ "type": "content_block_delta", "payload": { "index": 1, "delta": { "type": "input_json_delta", "partial_json": "{\"sql\":" }}}
{ "type": "content_block_stop", "payload": { "index": 1 }}

// thinking 块(可选)
{ "type": "content_block_start", "payload": { "index": 2, "content_block": { "type": "thinking", "thinking": "" }}}
{ "type": "content_block_delta", "payload": { "index": 2, "delta": { "type": "thinking_delta", "thinking": "用户问的是..." }}}
{ "type": "content_block_stop", "payload": { "index": 2 }}

// 流结束
{ "type": "message_delta", "payload": { "delta": { "stop_reason": "end_turn" }, "usage": { "output_tokens": 156 }}}
{ "type": "message_stop", "payload": {} }

// 错误
{ "type": "error", "payload": {
  "code": "rate_limit",
  "http_status": 429,
  "retry_after_ms": 20000,
  "message": "Rate limit exceeded"
}}

// 取消确认
{ "type": "interrupted", "payload": { "conversationId": "conv_01ABC", "reason": "user" }}
```

### A.3.4 协议版本

```ts
const PROTOCOL_VERSION = 1
const MIN_SUPPORTED = 1
const MAX_SUPPORTED = 1
```

`hello` 帧必带 `protocolVersion`。若客户端不支持此版本,发 `error { code: 'protocol_mismatch' }` 后关闭连接。

---

## A.4 WS 协议(Portal → Agent)

### A.4.1 帧类型清单

| `type` | 必需字段 | 说明 |
|---|---|---|
| `auth` | `token` | **WS 第一帧**,认证 |
| `user.message` | `conversationId`, `content`, `messageId` | 用户消息 |
| `user.interrupt` | `conversationId`, `reason?` | 取消正在进行的生成 |
| `ping` | `ts` | 心跳 |

### A.4.2 envelope 示例

```json
// 第一帧必须
{ "type": "auth", "payload": { "token": "Bearer eyJ..." } }

// 用户消息
{ "type": "user.message", "payload": {
  "conversationId": "conv_01ABC",
  "content": "本月蜜可诗营收多少?",
  "messageId": "tmp-uuid",                // 客户端临时 id(UUID v4,非时间戳)
  "brand": "蜜可诗",
  "attachments": [                        // 阶段 2:FILES API 引用
    { "type": "file", "file_id": "file_01XYZ" }
  ]
}}

// 取消
{ "type": "user.interrupt", "payload": { "conversationId": "conv_01ABC", "reason": "user" }}

// 心跳
{ "type": "ping", "payload": { "ts": 1720000000000 }}
```

---

## A.5 HTTP 接口

### A.5.1 健康与监控(保留)

```
GET /health                            → { status: 'ok' }
GET /ready                             → { status: 'ready' } | 503
GET /metrics                           → Prometheus text format
```

### A.5.2 历史事件查询(断线续传,阶段 3)

```
GET /api/chat/conversations/:conversationId/events?after=<eventId>&limit=100
Authorization: Bearer <jwt>

Response 200:
{
  "events": [
    { "id": "evt_001", "type": "content_block_delta", "payload": {...}, "ts": 1720000000000 },
    ...
  ],
  "has_more": false,
  "latest_event_id": "evt_050"
}
```

事件 id 全局唯一。**至少保留 24 小时**。

### A.5.3 文件上传(阶段 2)

```
POST /api/chat/upload
Authorization: Bearer <jwt>
Content-Type: multipart/form-data

Response 201:
{
  "file_id": "file_01XYZ",
  "filename": "report.pdf",
  "mime_type": "application/pdf",
  "size": 12345
}
```

走 Anthropic Files API beta(`files-api-2025-04-14`),后端存到 Anthropic,返回 `file_id`。前端引用方式:`{type: 'document', source: {type: 'file', file_id: 'file_01XYZ'}}`。

### A.5.4 会话 REST(保留,改 SDK 用法)

`/api/conversations*` 的 Portal 代理路径仍然走 HTTP 用于非流式操作(列表 / 重命名 / 删除 / 加载历史消息)。**只在 SDK 用法上对齐**(如调用到)。

Portal 代理历史消息响应:

```json
{
  "messages": [
    {
      "messageId": "msg_01ABC",
      "role": "assistant",
      "content": [
        { "type": "text", "text": "本月营收..." },
        { "type": "thinking", "thinking": "用户问的是..." }
      ],
      "status": "done",
      "stop_reason": "end_turn",
      "usage": { "input_tokens": 1234, "output_tokens": 567 },
      "createdAt": "2026-07-10T12:34:56Z"
    }
  ]
}
```

`content` 从字符串变为块数组,**前端 MessageList 必须按块渲染**(详见 [spec-chat-portal.md §B.5.2](../WGD_Portal/docs/spec-chat-portal.md#b52-组件改造))。旧数据兼容:字符串 content 自动包成 `[{type:'text', text: <string>}]`。

### A.5.5 测试/Admin 接口(保留,改 SDK 用法)

`/api/admin/*`、`/api/admin/test-chat`、`/api/admin/test-run`、`/api/admin/test-connection` —— 不变,但 `test-chat` / `test-run` 内部调用必须按 A.2.1(不再传 `temperature`)。

---

## A.6 鉴权

### A.6.1 弃用 HS256 双 secret,改 RS256 + JWKS(阶段 3)

```
# 旧(删除)
SUPABASE_JWT_SECRET=...
AGENT_JWT_SECRET=...

# 新
SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_ISSUER=https://<project-ref>.supabase.co/auth/v1
SUPABASE_AUDIENCE=authenticated
```

Agent 启动时拉一次 JWKS,缓存公钥。每次验签:
- 验证签名(`RS256`)
- 验证 `iss === SUPABASE_ISSUER`
- 验证 `aud === SUPABASE_AUDIENCE`
- 验证 `exp`(已包含)

代码示例(`jose` 包):

```ts
import { jwtVerify, createRemoteJWKSet } from 'jose'

const JWKS = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL!))

export async function verifyToken(token: string): Promise<{ sub: string; email?: string }> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.SUPABASE_ISSUER!,
    audience: process.env.SUPABASE_AUDIENCE!,
  })
  return { sub: payload.sub as string, email: payload.email as string | undefined }
}
```

### A.6.2 协议统一(阶段 3)

- HTTP: `Authorization: Bearer <jwt>` (Header)
- WS: `{type: 'auth', payload: {token: '...'}}` 第一帧,**不允许放 URL**

> ⚠️ **删掉** `AGENT_JWT_SECRET` env、`signAgentToken`(Portal 端)、`verifyAgentToken`(Agent 端)。

---

## A.7 系统 prompt 规范

### A.7.1 新的构建函数

```ts
// agent/src/agent/prompt.ts
import type Anthropic from '@anthropic-ai/sdk'

const AGENT_MD_CACHE_CONTROL: Anthropic.CacheControlEphemeral = {
  type: 'ephemeral',
  ttl: '1h',
}

export function buildSystemBlocks(agentMd: string): Anthropic.TextBlockParam[] {
  // 只放稳定内容进 system,挂 cache_control
  return [{
    type: 'text',
    text: agentMd,
    cache_control: AGENT_MD_CACHE_CONTROL,
  }]
}

export function buildSessionContextMessage(ctx: {
  today: string; brand: string | null; conversationId: string; channel: string
}): string {
  // 动态内容放第一条 user message,不影响 cache
  return `# Session Context (auto-injected, do not mention to user)
today: ${ctx.today}
brand: ${ctx.brand ?? '<none>'}
channel: ${ctx.channel}
conversationId: ${ctx.conversationId}
`
}
```

### A.7.2 注入位置

```ts
const messages: Anthropic.MessageParam[] = [
  { role: 'user', content: buildSessionContextMessage(ctx) },
  ...history.map(m => ({ role: m.role, content: m.content })),
  { role: 'user', content: msg.content },
]
```

---

## A.8 不变量(Agent 端硬要求)

1. **永远不传** `temperature` / `top_p` / `top_k` 到 `messages.create` 或 `toolRunner`
2. **永远不传** `thinking: { type: 'enabled', budget_tokens: N }`
3. **必须用** `stream: true`(非流式会被 Portal 端 reject)
4. **必须回传完整 `response.content`**,不准只挑 `tool_use`
5. **必须 catch SDK typed exception**,不准 catch 通用 Error
6. **必须处理 `stop_reason === 'refusal'`**,单独发 `error { code: 'refusal' }`
7. **WS 第一帧必须是 `auth`**,否则 60 秒后强制断开
8. **每个事件必须带 `id`**(用于 Portal 去重)
9. **prompt system 必须用数组,稳定内容挂 `cache_control`**
10. **`messages` 历史必须包含 `tool_calls` / `tool_results` 完整数据**(不要自实现 summarize 丢数据)

---

## A.9 环境变量清单(Agent 端)

```
# 数据库
DATABASE_URL=postgresql://agent:...

# Anthropic API key(从 DB 读,此处仅 env 解密种子)
AGENT_CRED_ENCRYPTION_KEY=<random 32+ chars>

# Supabase 鉴权(阶段 3 新)
SUPABASE_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_ISSUER=https://<ref>.supabase.co/auth/v1
SUPABASE_AUDIENCE=authenticated

# MCP
MCP_ENDPOINT=http://ui:3000/api/mcp

# 端口
WS_PORT=4101                       # HTTP
                                    # WS = WS_PORT + 1 = 4102(server.ts 自动)

# Cron
CRON_TIMEZONE=Asia/Shanghai

# 任务
TASK_WORKER_COUNT=4

# 协议
AGENT_PROTOCOL_VERSION=1

# 阶段 3 弃用
# AGENT_JWT_SECRET  # 不再使用
# SUPABASE_JWT_SECRET  # 不再使用(注意:Portal 也不再签 token)
```

---

## A.10 测试要求

### A.10.1 Agent 端

- **单元**:`thinkingConfigFor` 按 level 正确映射到 adaptive + effort
- **单元**:`stop_reason === 'refusal'` 触发 error 帧
- **单元**:WS auth 第一帧后才接受 user.message
- **单元**:`buildSystemBlocks` 第一条带 cache_control
- **集成**:`POST /api/admin/test-chat` 用新 SDK 参数成功(无 400)
- **集成**:`POST /api/admin/test-run` 用新 SDK 参数成功
- **集成**:`POST /api/chat/upload` 返回 `{file_id}`(阶段 2)
- **集成**:`GET /api/chat/conversations/:id/events?after=` 增量正确(阶段 3)

---

## 交叉引用

- 父计划:[chat-refactor-plan.md](./chat-refactor-plan.md)
- 对侧 spec:[spec-chat-portal.md](../WGD_Portal/docs/spec-chat-portal.md)
- 对齐表 + 联调清单:[alignment-and-checklist.md](./alignment-and-checklist.md)