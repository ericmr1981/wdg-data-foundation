# Chat ↔ Agent 通讯整改计划

> 范围:`WGD_Portal`(Next.js) ↔ `wdg-data-foundation/agent`(Fastify)
> 目标:协议对齐 Anthropic Messages API + 体验对齐 Claude.ai + 安全对齐 RS256/JWKS

---

## 1. 现状摘要

### 1.1 核心问题

- **Portal ↔ Agent 用自造 WS 协议**:`task_update` / `task_done` / `system_error`,丢 80% SDK 原始信息(text_delta / stop_reason / usage / tool_use.id / thinking)
- **Agent 用非流式 `messages.create`**,Portal 收到的是 step 增量,不是 text delta —— 体验是"等整段出现",不是"逐 token"
- **Agent 端 SDK 用法落后**:`temperature: 0.3` 永远传、`thinking: {type:'enabled', budget_tokens:N}` 旧式 —— 默认配置下 `claude-opus-4-8` 直接 400
- **JWT 双 secret 手动同步**(`SUPABASE_JWT_SECRET` ↔ `AGENT_JWT_SECRET`),改一边忘另一边就 401
- **大附件 base64 拼文本**,`/api/uploads` 写好没人用

### 1.2 协议不匹配清单

| 维度 | 自造 envelope | Anthropic 标准 |
|---|---|---|
| 流式文本 | 一次性 `task_done.content` | `content_block_delta{type:text_delta}` |
| 思考块 | 无 | `content_block_delta{type:thinking_delta}` |
| 工具调用 | 黑盒 `step` | `content_block_start{type:tool_use,id,name,input}` + `tool_result` |
| Stop reason | 二态(done / error) | `end_turn / tool_use / max_tokens / refusal / pause_turn / context_window_exceeded` |
| Usage | 无 | `input_tokens / output_tokens / cache_*_tokens` |
| Cache hint | 无 | `cache_read_input_tokens > 0` 即缓存命中 |
| 错误分类 | 字符串 `code` | SDK typed exception(`RateLimitError` 等) |

---

## 2. 整改目标(可验收)

1. **体验对齐 Claude.ai**:文本逐 token 流式、thinking 可折叠、tool_use 结构化卡片
2. **协议对齐 Anthropic Messages API**:WS 帧类型与 `messages.stream()` 输出 1:1,前端直接消费 SDK 原生 content block
3. **错误分类完整**:SDK typed exception → WS `error` 帧 → 前端区分 5 类
4. **新模型兼容**:`claude-opus-4-8` 默认配置不 400,后续切 Sonnet 5 / Fable 5 也不 400
5. **断线续传**:每事件带 `id`,重连后从 history 接口拉增量
6. **取消生成**:用户点"停止" → `user.interrupt` → Agent 取消 in-flight LLM
7. **大附件**:Files API,1MB 阈值去掉,走 `/api/chat/upload` 独立端点
8. **JWT 单一来源**:改 RS256 + JWKS,删双 secret 同步
9. **取消 / 重试 / 编辑** 三类基础交互齐备

---

## 3. 阶段路线图

| 阶段 | 时长 | 范围 | 验收 | 依赖 |
|---|---|---|---|---|
| **0 止血** | 1-2 天 | Agent SDK 参数 | 不报 400 | 无 |
| **1 协议换骨架** | 2-3 天 | WS envelope 换成 SDK 原生事件 | 打字机 + thinking 折叠 + 错误分类 | 阶段 0 |
| **2 功能补齐** | 3-5 天 | 取消 / 附件 / 重试编辑 / prompt caching | 大文件可传、取消不烧 token | 阶段 1 |
| **3 可靠性+安全** | 3-5 天 | JWT/JWKS、断线续传、compaction、notifier | 重连不丢、改 secret 自动同步 | 阶段 1 |

### 3.1 阶段 0:止血(Agent SDK 参数对齐)

**只动 Agent,不动 Portal、不动协议**。

- [ ] `runner.ts` 的 `messages.create` 调用去掉 `temperature`
- [ ] `thinking` 改成 `{type: 'adaptive'}` + `output_config: {effort}`
- [ ] `thinkingConfigFor` 重写:不再产出 `budget_tokens`
- [ ] DB params schema 标记 `temperature` 字段 deprecated
- [ ] 跑 `POST /api/admin/test-chat` + `test-run` 不报 400

### 3.2 阶段 1:协议换骨架

**保留 WS,只换 envelope**。WS 连接、鉴权、重连策略都不动,只改帧类型。

- [ ] 定义新 envelope(详见 [spec-chat-agent.md §3.2](./spec-chat-agent.md#32-帧类型清单))
- [ ] Agent 端:`toolRunner({stream: true})` 替换手写 `while (iter < maxToolChainDepth)`
- [ ] Agent 端:SDK 原始事件直接透传(`message_start` / `content_block_*` / `message_delta` / `message_stop`)
- [ ] Agent 端:catch SDK typed exception → `error` 帧
- [ ] Agent 端:处理 `stop_reason === 'refusal'` → 单独 `error {code:'refusal'}`
- [ ] Portal 端:`useAgentSocket` 改成 TS + 纯转发,事件路由给 ChatShell
- [ ] Portal 端:ChatShell 内部 reducer 按 content block 累积
- [ ] Portal 端:MessageList 块级渲染(text / thinking / tool_use / tool_result)
- [ ] Portal 端:Composer 用 `crypto.randomUUID()` 替换 `tmp-${Date.now()}`
- [ ] Portal 端:Composer 加"停止"按钮(本期不接 Agent,仅 UI)
- [ ] 联调清单阶段 1 通过(见 [alignment-and-checklist.md](./alignment-and-checklist.md))

### 3.3 阶段 2:功能补齐

- [ ] Agent 端:`/api/chat/upload` 接 Anthropic Files API(`files-api-2025-04-14`)
- [ ] Agent 端:`/api/chat/conversations/:id/messages` 历史加载改成返回 content block 数组(兼容旧字符串)
- [ ] Agent 端:`user.interrupt` → AbortController → SDK `signal` 选项
- [ ] Agent 端:删除 base64 内联、1MB 阈值相关代码
- [ ] Agent 端:Prompt caching —— `buildSystemBlocks` 返回数组,稳定内容挂 `cache_control: {ttl: '1h'}`
- [ ] Portal 端:Composer 调用 `/api/chat/upload`,无 1MB 阈值
- [ ] Portal 端:`user.message` 的 `attachments` 字段从 base64 改为 `{type:'file', file_id}`
- [ ] Portal 端:MessageList 加 retry / edit 按钮
- [ ] Portal 端:"停止"按钮接 `user.interrupt`

### 3.4 阶段 3:可靠性 + 安全

- [ ] Agent 端:`verifyAgentToken` 重写为 RS256 + JWKS(`jose` 包)
- [ ] Agent 端:`AGENT_JWT_SECRET` 弃用,改 `SUPABASE_JWKS_URL` / `SUPABASE_ISSUER` / `SUPABASE_AUDIENCE`
- [ ] Agent 端:WS 第一帧 `{type: 'auth', payload: {token}}` 鉴权(替代 URL `?token=`)
- [ ] Agent 端:`GET /api/chat/conversations/:id/events?after=<id>` 历史事件查询接口
- [ ] Agent 端:服务端 compaction `compact-2026-01-12` 替代 `maybeCompress`
- [ ] Agent 端:`notifier` 实现真 pub/sub(CronChannel → WebChannel 路由)
- [ ] Portal 端:`/api/agent-token` 改成返回 Supabase access_token(不签 HS256)
- [ ] Portal 端:删除 `src/lib/agent-token.js`
- [ ] Portal 端:`useAgentSocket` 重连后拉 `events?after=lastSeenId` 去重
- [ ] Portal 端:`localStorage` 持久化 `lastEventId:<conversationId>`

---

## 4. 关键决策

| 决策项 | 选 | 不选 | 原因 |
|---|---|---|---|
| 实时通道 | **WebSocket** | SSE | 双向 interrupt;中间帧 ack;ws-proxy 已稳 |
| 协议层 | **Anthropic 标准事件透传** | 自造精简 envelope | 减少翻译层;前端直接消费 |
| Agent loop | **Tool Runner + stream** | 手写 while loop | SDK 自动管 stop_reason / pause_turn / message 累积 |
| Thinking | **adaptive + output_config.effort** | budget_tokens | 新模型 400;粒度更细 |
| Sampling 参数 | **彻底不传** | 保留兼容字段 | Opus 4.7+/Sonnet 5 必 400 |
| 鉴权 | **RS256 + JWKS(Supabase)** | HS256 共享 secret | 单一来源,无需双 secret 同步 |
| Token 传输 | **WS 第一帧 auth** | URL query string | 不进 access log / referer / history |
| 附件 | **Files API + /api/chat/upload** | base64 拼文本 | 1MB 阈值去掉;content 不被污染 |
| 长会话 | **服务端 compaction** | 手写 sliding window | SDK 标准;保留 tool_use_id 链 |
| Cache | **cache_control 在 system block** | 拼字符串 system | 动态内容挪到 message,cache 才能 hit |
| Cancel | **AbortController + user.interrupt** | 不支持 | 用户体验必备 |

---

## 5. 兼容性 / 回退策略

- 新协议上线时,**保留旧 envelope 解析 1 周**:Agent 端双写(同时发 `task_done` 和 `message_stop`),Portal 端按 `protocolVersion` 字段判定
- Portal 端 `useAgentSocket` 引入 `protocolVersion` 探测:握手第一帧 `{type: 'hello', protocolVersion: 1}`,Portal 按版本走不同解析路径
- 回退:`AGENT_PROTOCOL_VERSION=0` 切回旧协议(默认 1)
- 阶段 1 完成 + 联调通过后:**关闭旧协议** —— Agent 不再发 `task_done` 等旧帧,Portal 不再解析

---

## 6. 关键依赖顺序

1. **阶段 0** —— Agent 端单方改,Portal 无感知
2. **阶段 1** —— **Agent 端先发新版协议**,Portal 端用 `protocolVersion` 探测,过渡期内支持双协议解析
3. **阶段 2** —— 大附件、取消、prompt caching,可分批
4. **阶段 3** —— JWT 改 JWKS、断线续传、compaction

---

## 7. 沟通准则

两份 spec 是协议 / 字段 / 事件 / 路径的**唯一来源**:

- [spec-chat-agent.md](./spec-chat-agent.md) — Agent 端实现细节
- [spec-chat-portal.md](../WGD_Portal/docs/spec-chat-portal.md) — Portal 端实现细节
- [alignment-and-checklist.md](./alignment-and-checklist.md) — 对齐表 + 联调清单

任何字段名 / 帧类型 / 事件名 / HTTP 路径 / env 变量改动,必须同步更新对应 spec。

---

## 8. 整改文件清单(预估工作量)

### 8.1 Agent 仓库(wdg-data-foundation)

| 文件 | 改动 | 阶段 |
|---|---|---|
| `agent/src/agent/runner.ts` | 大改(用 Tool Runner + stream) | 1 |
| `agent/src/agent/prompt.ts` | 中改(返回数组) | 1 + 2 |
| `agent/src/channels/web.ts` | 中改(WS auth + frame 适配) | 1 + 3 |
| `agent/src/channels/auth.ts` | 重写(RS256 + JWKS) | 3 |
| `agent/src/conversation/manager.ts` | 中改(去 maybeCompress,改 compaction) | 3 |
| `agent/src/config/store.ts` | 小改(去 temperature 默认) | 0 |
| `agent/src/api/conversations.ts` | 小改(适配新 SDK) | 1 |
| `agent/src/api/admin/test-*.ts` | 小改(适配新 SDK) | 0 |
| 新增 `agent/src/api/chat/upload.ts` | 新文件 | 2 |
| 新增 `agent/src/api/chat/events.ts` | 新文件 | 3 |

### 8.2 Portal 仓库(WGD_Portal)

| 文件 | 改动 | 阶段 |
|---|---|---|
| `WGD_Portal/src/lib/useAgentSocket.js` | 重写为 `.ts` | 1 |
| `WGD_Portal/src/components/chat/ChatShell.jsx` | 大改(reducer + 状态机) | 1 |
| `WGD_Portal/src/components/chat/Composer.jsx` | 中改(去 base64 + 加 stop) | 1 + 2 |
| `WGD_Portal/src/components/chat/MessageList.jsx` | 大改(块级渲染) | 1 |
| `WGD_Portal/src/components/chat/Sidebar.jsx` | 小改(撤销/重试/编辑) | 2 |
| `WGD_Portal/src/lib/agent-token.js` | 删除 | 3 |
| `WGD_Portal/pages/api/agent-token.js` | 重写(取 Supabase access_token) | 3 |
| `WGD_Portal/pages/api/uploads.js` | 删除或代理到 Agent | 2 |
| 新增 `WGD_Portal/src/lib/ws-types.ts` | 新文件 | 1 |