# Chat ↔ Agent 对齐表 + 联调清单

> 三方协作的唯一参考表,Agent 开发者与 Portal 开发者都要查
> 配套:[chat-refactor-plan.md](./chat-refactor-plan.md) · [spec-chat-agent.md](./spec-chat-agent.md) · [spec-chat-portal.md](../WGD_Portal/docs/spec-chat-portal.md)

---

## 1. 文件清单

| 文件 | 仓库 | 路径 |
|---|---|---|
| 整改计划 | wdg-data-foundation | `docs/chat-refactor-plan.md` |
| Spec A(Agent 侧) | wdg-data-foundation | `docs/spec-chat-agent.md` |
| Spec B(Portal 侧) | WGD_Portal | `docs/spec-chat-portal.md` |
| 对齐表 + 联调清单(本文) | wdg-data-foundation | `docs/alignment-and-checklist.md` |

---

## 2. 协议字段对齐(单一来源)

任何字段名 / 帧类型 / 事件名 / HTTP 路径 / env 变量,以本文 §2 与两份 spec 为唯一来源。三方任何一边改动,**必须**同步更新 §2 + 对应 spec。

### 2.1 WS 帧类型(Portal ↔ Agent)

| 方向 | `type` | Spec A 节 | Spec B 节 |
|---|---|---|---|
| A→P | `hello` | A.3.1 | B.3.1 |
| A→P | `ack` | A.3.2 | B.3.2 |
| A→P | `message_start` | A.3.2 | B.3.2 |
| A→P | `content_block_start` | A.3.2 | B.3.2 |
| A→P | `content_block_delta` | A.3.2 | B.3.2 |
| A→P | `content_block_stop` | A.3.2 | B.3.2 |
| A→P | `message_delta` | A.3.2 | B.3.2 |
| A→P | `message_stop` | A.3.2 | B.3.2 |
| A→P | `message` | A.3.2 | B.3.2 |
| A→P | `error` | A.2.5 | B.3.3 |
| A→P | `interrupted` | A.2.7 | B.3.2 |
| A→P | `ping` / `pong` | A.3.1 | B.4.1 |
| P→A | `auth` | A.4.1 | B.4.1 |
| P→A | `user.message` | A.4.2 | B.4.1 |
| P→A | `user.interrupt` | A.2.7 | B.4.1 |

### 2.2 错误码(单一列表)

| `code` | 来源 | HTTP 状态 | Portal UI |
|---|---|---|---|
| `rate_limit` | `Anthropic.RateLimitError` | 429 | 倒计时 + 自动重试 |
| `auth` | `Anthropic.AuthenticationError` | 401 | 红色 banner,不可重试 |
| `permission` | `Anthropic.PermissionDeniedError` | 403 | 红色 banner |
| `not_found` | `Anthropic.NotFoundError` | 404 | 红色 banner |
| `network` | `Anthropic.APIConnectionError` | 0 | 黄色 banner,自动重连 |
| `bad_request` | `Anthropic.BadRequestError` | 400 | 红色 |
| `refusal` | `stop_reason === 'refusal'` | 200 | 灰色提示,不重试 |
| `context_overflow` | `stop_reason === 'model_context_window_exceeded'` | 200 | 蓝色提示开启新会话 |
| `protocol_mismatch` | 版本不匹配 | (自定义 close code 4000) | 引导刷新 |
| `unknown` | 兜底 | 500 | 通用 + retry 按钮 |

### 2.3 Stop reason 处理

| `stop_reason` | Agent 行为 | Portal 行为 |
|---|---|---|
| `end_turn` | 发 `message_stop`,关闭 stream | 标记 done |
| `tool_use` | Tool Runner 自动递归 | 继续 streaming(不结束) |
| `max_tokens` | 透传 message_delta;发 message_stop | 提示可能截断 + "继续生成"按钮 |
| `refusal` | 发 `error { code: 'refusal' }` | 显示拒绝提示,不重试 |
| `pause_turn` | Tool Runner 自动恢复 | (无) |
| `model_context_window_exceeded` | 发 `error { code: 'context_overflow' }` | 提示开启新会话 |

### 2.4 HTTP 路径对齐

| 用途 | Agent 路径 | Portal 代理路径 |
|---|---|---|
| 健康检查 | `GET /health` | (Portal 不代理) |
| 历史消息 | `GET /api/conversations/:id/messages` | `GET /api/sessions/:id/messages` |
| 会话 CRUD | `/api/conversations*` | `/api/sessions*` |
| 文件上传(阶段 2) | `POST /api/chat/upload` | `POST /api/chat/upload`(直连 Agent) |
| 历史事件(阶段 3) | `GET /api/chat/conversations/:id/events` | `GET /api/chat/conversations/:id/events` |
| 测试(保留) | `POST /api/admin/test-chat` / `test-run` / `test-connection` | (Portal 不代理) |

### 2.5 env 变量对齐

| 变量 | Agent | Portal | 说明 |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✗ | Agent 专用 |
| `AGENT_CRED_ENCRYPTION_KEY` | ✓ | ✗ | Agent 专用(解密 DB 中存的 API key) |
| `MCP_ENDPOINT` | ✓ | ✗ | Agent 专用 |
| `WS_PORT` | ✓ | ✗ | Agent 专用(4101,WS = +1) |
| `CRON_TIMEZONE` | ✓ | ✗ | Agent 专用 |
| `TASK_WORKER_COUNT` | ✓ | ✗ | Agent 专用 |
| `NEXT_PUBLIC_SUPABASE_URL` | ✗ | ✓ | Portal 专用 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✗ | ✓ | Portal 专用 |
| `NEXT_PUBLIC_AGENT_WS_URL` | ✗ | ✓ | Portal 专用(`ws://agent:4102`) |
| `SUPABASE_JWKS_URL` | ✓(阶段 3) | ✓(阶段 3) | **共享同一值**,改 secret 时自动同步 |
| `SUPABASE_ISSUER` | ✓(阶段 3) | ✓(阶段 3) | 共享 |
| `SUPABASE_AUDIENCE` | ✓(阶段 3) | ✓(阶段 3) | 共享 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✗ | ✓(阶段 3) | Portal 取 access_token 用 |
| `AGENT_PROTOCOL_VERSION` | ✓ | ✗ | Agent 专用 |
| ~~`SUPABASE_JWT_SECRET`~~ | ~~✗~~(阶段 3 弃用) | ~~✗~~(阶段 3 弃用) | 不再使用 |
| ~~`AGENT_JWT_SECRET`~~ | ~~✗~~(阶段 3 弃用) | ✗ | 不再使用 |

### 2.6 不变量(双向)

| 项 | Agent 端 | Portal 端 |
|---|---|---|
| `temperature/top_p/top_k` 永传 | 不传 | (N/A) |
| `thinking: {budget_tokens}` 永传 | 不传 | (N/A) |
| `stream: true` | 必须 | (N/A) |
| `response.content` 回传完整性 | 整段回传 | (N/A) |
| SDK typed exception catch | 必须 | (N/A) |
| `stop_reason === 'refusal'` 处理 | 发 `error { code: 'refusal' }` | 显示拒绝,不重试 |
| WS token URL 出现 | (N/A) | 禁止;只第一帧 auth |
| WS 第一帧必须是 `auth` | 收到后才接 user.message | 必须 |
| 事件 id | 必须带 | 按 id 去重 + 持久化 |
| Anthropic SDK 直接调用 | 仅 Agent | **禁止 Portal 直接调** |
| Content 渲染 | (N/A) | 按 block 渲染,不拼字符串 |
| messageId | (N/A) | `crypto.randomUUID()`,不用 `Date.now()` |
| 大附件走 Files API | `/api/chat/upload` | 不再 base64 拼 content |

---

## 3. 工作分配表(谁实现什么、互相依赖)

| 项目 | Spec A(Agent) | Spec B(Portal) | 依赖 | 阶段 |
|---|---|---|---|---|
| WS 新协议(7 类事件 + 3 类心跳) | 实现发送端 | 实现接收端 | 互相 | 1 |
| `stop_reason === 'refusal'` 处理 | 发 `error {code:'refusal'}` 帧 | UI 显示拒绝提示 | A→B | 1 |
| `stop_reason === 'tool_use'` 处理 | Tool Runner 自动递归 | UI 继续 streaming(不结束) | A→B | 1 |
| `stop_reason === 'max_tokens'` 处理 | 透传 + 可选续传 | UI 提示可能截断 | 互相 | 1 |
| SDK typed exception → error 帧 | catch 链 + 分类 | UI 按 code 渲染 | A→B | 1 |
| 流式 text delta / thinking delta | SDK stream → WS 透传 | reducer 累积 | A→B | 1 |
| Tool Runner(替换手写 loop) | 必用 | (无) | — | 1 |
| `thinking: {type:'adaptive'}` + `effort` | 必用 | (无) | — | 0 |
| 不传 `temperature` / `top_p` / `top_k` | 必用 | (无) | — | 0 |
| Prompt caching `cache_control` | system 数组 + 第一条挂 | (无) | — | 2 |
| `user.interrupt` 取消 | 接收 + AbortController | Composer 发 `user.interrupt` | 互相 | 2 |
| 大附件 Files API | `/api/chat/upload` 走 Anthropic Files | Composer 调 `/api/chat/upload`,1MB 阈值删 | A→B | 2 |
| `compact-2026-01-12` 服务端 compaction | 启用 beta header | (无) | — | 3 |
| 断线续传:历史事件查询 | `GET /api/chat/conversations/:id/events` | 重连后拉增量 | A→B | 3 |
| JWT 改 RS256 + JWKS | 验证 Supabase JWKS | 不再签 HS256 token | 互相 | 3 |
| WS token 第一帧 auth | 接 `{type:'auth'}` | 第一帧发 | 互相 | 3 |
| 取消 / 重试 / 编辑消息 UI | (无) | Composer + MessageList 实现 | — | 2 |
| `notifier` 真做 | CronChannel → WebChannel | (无) | — | 3 |

---

## 4. 阶段 1 联调清单(必过)

> 阶段 1 是改动量最大、风险最集中的一步。以下每条都必须通过才能进阶段 2。

### 4.1 握手与认证

- [ ] **T1.1** Agent 启动后,WS 客户端能连接;连接后立即收到 `{type:'hello', payload:{protocolVersion:1}}`
- [ ] **T1.2** Portal 收到 hello 后,protocolVersion 匹配(否则 close 4000,UI 显示"版本不匹配")
- [ ] **T1.3** Portal 在 `ws.onopen` 后第一帧发 `{type:'auth', payload:{token}}`
- [ ] **T1.4** Agent 在收到 `auth` 帧前,丢弃任何 `user.message`(不进入处理队列)
- [ ] **T1.5** Agent 在 `auth` 帧后,在 hello 中设 `authedRef=true`,Portal 才开始 flush pending
- [ ] **T1.6** 旧 `?token=` URL 参数:**完全不再使用**,Portal 也不再带

### 4.2 消息流

- [ ] **T2.1** 用户输入 → Composer 立即插入 status=`pending` 的 user message(id 为 `crypto.randomUUID()`)
- [ ] **T2.2** Portal 发 `user.message` → Agent 立即回 `ack { messageId }`(≤200ms)
- [ ] **T2.3** Portal 收到 ack 后,user message 从 `pending` → `sent`,id 替换为 ack 的 messageId
- [ ] **T2.4** Agent 处理中按 SDK 顺序推:`message_start` → `content_block_start` → 多个 `content_block_delta`(text_delta) → `content_block_stop` → `message_delta` → `message_stop`
- [ ] **T2.5** Portal 收到每条 `content_block_delta` 时,**UI 立即追加**(打字机效果,无延迟)
- [ ] **T2.6** 最终 assistant message 从 `streaming` → `done`

### 4.3 Thinking 块

- [ ] **T3.1** 若 assistant 输出包含 thinking block,Agent 推 `content_block_start {type:'thinking'}` + 多个 `thinking_delta` + `content_block_stop`
- [ ] **T3.2** Portal MessageList 渲染 thinking 块为可折叠(默认折叠)

### 4.4 Tool use

- [ ] **T4.1** 若 assistant 调用 tool,Agent 推 `content_block_start {type:'tool_use', id, name, input}` + `input_json_delta` 累积
- [ ] **T4.2** Portal MessageList 渲染 tool_use 卡片(显示 name + 参数,可展开)
- [ ] **T4.3** Tool Runner 自动递归:tool_result 后下一轮 `message_start` 是新一轮 assistant 输出

### 4.5 错误分类

- [ ] **T5.1** 触发 rate limit:Agent 发 `error { code:'rate_limit', retry_after_ms }`,Portal UI 显示倒计时
- [ ] **T5.2** 触发 401:Agent 发 `error { code:'auth' }`,Portal UI 红色 banner,不重试
- [ ] **T5.3** 触发 403:Agent 发 `error { code:'permission' }`,Portal UI 红色 banner
- [ ] **T5.4** 触发 `stop_reason === 'refusal'`:Agent 发 `error { code:'refusal', category }`,Portal UI 灰色提示,不重试
- [ ] **T5.5** 触发 `stop_reason === 'context_window_exceeded'`:Agent 发 `error { code:'context_overflow' }`,Portal UI 提示开启新会话

### 4.6 内容块完整性

- [ ] **T6.1** Agent 不再发旧 `task_update` / `task_done` / `system_error` 帧(完全弃用)
- [ ] **T6.2** Portal 不再解析旧 envelope(`onUpdate` / `onDone` / `onError` callback 删除)
- [ ] **T6.3** Agent 不再传 `temperature` 到 SDK(用 admin test 接口验证无 400)

### 4.7 SDK 参数

- [ ] **T7.1** `POST /api/admin/test-chat` 用 `claude-opus-4-8` + `thinkingLevel:'off'` → 200 OK
- [ ] **T7.2** `POST /api/admin/test-chat` 用 `claude-opus-4-8` + `thinkingLevel:'high'` → 200 OK(走 adaptive)
- [ ] **T7.3** 旧 `thinking: {budget_tokens:N}` 形式在代码库中**完全搜不到**(grep 验证)
- [ ] **T7.4** 旧 `temperature: 0.3` 在 `messages.create` 调用中**完全搜不到**(grep 验证)

### 4.8 联调签字

- [ ] Agent 端:_______________ 日期:_______
- [ ] Portal 端:_______________ 日期:_______
- [ ] 测试通过标志:**阶段 1 关闭旧协议**(`AGENT_PROTOCOL_VERSION` 不再支持 `0`)

---

## 5. 阶段 2 联调清单

- [ ] **T2-1.1** 用户拖文件(任意大小,无 1MB 限制)→ Composer 调 `POST /api/chat/upload` → 返回 `{file_id}`
- [ ] **T2-1.2** 用户发送 → WS `user.message.attachments = [{type:'file', file_id}]`
- [ ] **T2-1.3** Agent 把 attachments 转成 Anthropic content block `{type:'document', source:{type:'file', file_id}}` 传给 SDK
- [ ] **T2-1.4** Agent 用 `beta.messages.create`(File API beta header)
- [ ] **T2-2.1** streaming 时点击"停止"→ Portal 发 `user.interrupt`
- [ ] **T2-2.2** Agent 收到后调 `abortController.abort()` → SDK 抛 AbortError
- [ ] **T2-2.3** Agent 发 `interrupted` 帧,Portal 标记 streaming message 为 `interrupted`,UI 显示"已停止"
- [ ] **T2-2.4** 取消后 token 不再被消耗(从 Anthropic 控制台验证)
- [ ] **T2-3.1** assistant message 上 hover 显示"重试"按钮 → 点击发同一条 user message
- [ ] **T2-3.2** user message 上 hover 显示"编辑"按钮 → 点击变 textarea → 修改后发新消息
- [ ] **T2-4.1** Portal 看到 `cache_read_input_tokens > 0` 时,UI 显示"已缓存"角标
- [ ] **T2-4.2** system prompt 第一次请求 `cache_creation_input_tokens > 0`,第二次起 `cache_read_input_tokens > 0`

---

## 6. 阶段 3 联调清单

- [ ] **T3-1.1** Agent 启动时调用 `SUPABASE_JWKS_URL` 拉公钥
- [ ] **T3-1.2** Portal `/api/agent-token` 返回 Supabase access_token(不再签 HS256)
- [ ] **T3-1.3** Agent 用 JWKS 公钥验签 RS256,验证 `iss` 和 `aud`
- [ ] **T3-1.4** 在 Supabase 控制台轮换 JWT secret → Agent 自动跟着验签(无需重启,无需手动同步 env)
- [ ] **T3-1.5** `SUPABASE_JWT_SECRET` 和 `AGENT_JWT_SECRET` env 在两边的部署配置中**完全删除**
- [ ] **T3-2.1** WS 第一帧必须是 `auth`,Portal 不再把 token 放 URL
- [ ] **T3-2.2** `?token=` URL 参数**完全不再使用**(grep 验证两边代码)
- [ ] **T3-3.1** Agent 暴露 `GET /api/chat/conversations/:id/events?after=<id>`
- [ ] **T3-3.2** Portal 重连后调用该接口,按 event id 去重
- [ ] **T3-3.3** 飞行模式断网 60 秒再恢复,无事件丢失、无重复
- [ ] **T3-4.1** Agent 用 `compact-2026-01-12` beta header + `context_management: { edits: [{ type: 'compact_20260112' }] }`
- [ ] **T3-4.2** 长会话(>150K tokens)触发后,Agent 收到包含 compaction block 的 response,整段 content 回传(含 compaction block)
- [ ] **T3-4.3** Portal UI 看到 compaction block 时显示"会话已压缩"提示
- [ ] **T3-4.4** `ConversationManager.maybeCompress` 函数**完全删除**(grep 验证)
- [ ] **T3-5.1** CronChannel 触发的回复能通过 WebChannel 到达用户浏览器
- [ ] **T3-5.2** `NullNotifier` 类**完全删除**(grep 验证)

---

## 7. 沟通准则

1. **任何字段名 / 帧类型 / 事件名**改动,必须同步更新:
   - §2(对齐表)
   - 对应 spec(spec-chat-agent.md 或 spec-chat-portal.md)
2. **任何 SDK 参数变更**(`thinking` / `temperature` 等)必须同步 A.2.1
3. **任何 HTTP 路径变更**必须同步 A.5、B.7、§2.4
4. **env 变量**新增 / 删除必须同步 A.9、B.11、§2.5
5. **每完成一个阶段**,出联调报告(谁测的、覆盖了什么、有什么问题)
6. **spec 之间冲突时**:以 §2(本文)为最终裁定。两份 spec 必须更新以匹配 §2。

---

## 8. 文件位置确认

```
/Users/ericmr/Documents/GitHub/wdg-data-foundation/docs/
├── chat-refactor-plan.md        ← 整改计划(总览)
├── spec-chat-agent.md            ← Spec A(给 Agent 开发者)
└── alignment-and-checklist.md    ← 本文(对齐表 + 联调清单)

/Users/ericmr/Documents/GitHub/WGD_Portal/docs/
└── spec-chat-portal.md           ← Spec B(给 Portal 开发者)
```