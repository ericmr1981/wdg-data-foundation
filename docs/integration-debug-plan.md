# Portal ↔ Agent 联调计划(2026-07-10)

> 配套:[chat-refactor-plan.md](./chat-refactor-plan.md) · [spec-chat-agent.md](./spec-chat-agent.md) · [spec-chat-portal.md](../WGD_Portal/docs/spec-chat-portal.md) · [alignment-and-checklist.md](./alignment-and-checklist.md)

---

## 1. 当前状态(信息收集结果)

### 1.1 已确认的事实

| 项 | 状态 | 来源 |
|---|---|---|
| Agent 仓库已切到 v1 协议 | ✅ R0/R1b/R5/R7/R8/R9 都已合(12 commits) | `wdg-data-foundation` git log |
| Agent 服务在跑 | ✅ `curl 127.0.0.1:4101/health` = `{"status":"ok"}`,4102 WS upgrade 成功 | 探针 |
| WS 握手 + hello + protocolVersion=1 | ✅ 连接后立即收到 `{"type":"hello","payload":{"protocolVersion":1,"sessionId":"srv"}}` | `scripts/probe-agent-ws.mjs` |
| 伪造 token → 拒绝 | ✅ `close code:1008, reason:invalid_token` | 探针 |
| Agent HTTP 鉴权切到 RS256 + JWKS | ✅ `verifyAgentToken` 用 `jose.jwtVerify` + `createRemoteJWKSet` | `agent/src/channels/auth.ts` |
| `/api/conversations/:id/messages` 路由存在 | ✅ 401 未授权返 `{"error":"unauthorized"}` | curl |
| HS256 token(Portal 当前签的) | ❌ Agent 401 拒 | curl |
| Supabase JWKS endpoint 可达 | ✅ `https://ltwqcvqfwwvjrcwnwvvn.supabase.co/auth/v1/.well-known/jwks.json` | curl |

### 1.2 发现的问题

#### 🔴 P0 — Agent 端 R7 alg 写错(阻塞)

[agent/src/channels/auth.ts:27](file:///Users/ericmr/Documents/GitHub/wdg-data-foundation/agent/src/channels/auth.ts#L27):

```ts
const { payload } = await jwtVerify(token, jwks(), { algorithms: ['RS256'] })
```

但 Supabase JWKS 返回 `alg=ES256`(ECDSA P-256):
```json
{"alg":"ES256","crv":"P-256","kty":"EC",...}
```

**RS256 vs ES256 算法不兼容** —— 即使 Portal 端改成传 Supabase 真 access_token,Agent 也会因为 alg mismatch 拒掉。

**修复**:把 `algorithms: ['RS256']` 改成 `['ES256']` 或 `['RS256', 'ES256']`(后者更兼容,允许 RS256 自签场景)。

#### 🔴 P0 — Portal 端还在签 HS256(阻塞)

[pages/api/sessions/index.js:8](file:///Users/ericmr/Documents/GitHub/WGD_Portal/pages/api/sessions/index.js#L8) 仍调用 `signAgentToken`(HS256 + `SUPABASE_JWT_SECRET`)。Agent 不再接受这种 token → Portal→Agent 的所有 HTTP 转发都 401。

**修复**:
- 选项 A:Portal `/api/sessions/*` 改成转发 Supabase access_token(从 user cookie 拿,或调 Supabase)
- 选项 B:Portal `/api/auth/jwks.json` 暴露 Supabase JWKS(让 Agent 也信任 portal 发的 HS256 token)

按 spec-chat-portal.md §B.8 的方案是 A:Portal 从 Supabase session 取 access_token 直接转发。

#### 🟡 P1 — Portal `/api/auth/jwks.json` 不存在(联调阻塞)

spec-chat-portal.md §B.8.2 提到 Portal 端需要改造,但当前仓库 `pages/api/auth/` 只有 `dev-login.js` / `dev-logout.js`,**没有 jwks.json 路由**。

#### 🟡 P1 — Portal 本地未启动新代码

`curl http://localhost:3000/` 没响应(没起服务)。需要 portal dev agent 完成 §B.8 后,把新代码部署并启动。

### 1.3 与原列表"会卡的地方"对照

| 列表说的 | 实际情况 |
|---|---|
| AGENT_PROTOCOL_VERSION 两端都没启用 → 不要急切版本 | ✅ 部分对,Agent 已发 `protocolVersion:1`,但 `AGENT_PROTOCOL_VERSION` env 没找到暴露点 —— 当前是硬编码 1 |
| VM 没设 SUPABASE_JWKS_URL env → RS256 验签 fail | ❌ 不完全对 —— **JWKS endpoint 可达且返回了 key**,但 alg 写错 ES256 → 任何真 Supabase token 也会被拒 |
| Portal 端 `/api/agent-token` 还没改 | ❌ 没改 —— 但不止这个,**`/api/sessions/*` 的 token 转发也没改** |
| WS 第一帧 auth 也卡 | ❌ 不完全对 —— WS 第一帧 auth 协议本身已实现,但**没有合法 token 能过 RS256+JWKS 校验** |

---

## 2. 联调清单(分阶段)

### 阶段 A:修复 P0 阻塞(Agent + Portal 各一处)

#### A.1 Agent:alg 兼容(15 分钟)

**文件**:`agent/src/channels/auth.ts`
```ts
// 当前
const { payload } = await jwtVerify(token, jwks(), { algorithms: ['RS256'] })

// 改成(允许 RS256 和 ES256,Supabase 默认是 ES256)
const { payload } = await jwtVerify(token, jwks(), {
  algorithms: ['RS256', 'ES256']
})
```

**验证**:
```bash
# 重启 Agent 后,Probe 应该 close 1008 invalid_token(fake token 不变),
# 但有合法 Supabase token 时应该走通(后续阶段测)
```

#### A.2 Portal:token 转发切换(1-2 小时)

**文件**:
- `pages/api/sessions/[id].js`
- `pages/api/sessions/index.js`
- `pages/api/agent-token.js`

**改动**(参 spec-chat-portal.md §B.8):
```js
// /api/agent-token.js: 改成从 Supabase session 取 access_token
import { getCurrentUser } from '../../src/lib/auth.js'
import { supabase } from '../../src/lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  const user = getCurrentUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  
  // 从 Supabase 取当前 session 的 access_token
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) {
    // 兜底:dev cookie session 不是 Supabase user,需要 fallback
    return res.status(401).json({ error: 'no_supabase_session' })
  }
  return res.status(200).json({ token: session.access_token, exp: session.expires_at })
}

// /api/sessions/*: 改成转发 Supabase cookie 给 Agent,不再自己签
// (Portal 端不再持 SUPABASE_JWT_SECRET —— 改依赖 SUPABASE_SERVICE_ROLE_KEY
//  或者让浏览器在每次请求带 Authorization header)
```

**问题**:Portal 当前用 `wgd_session` cookie 存**自建 session**,**不是 Supabase Auth 的 session**。所以 `supabase.auth.getSession()` 拿不到东西。

需要先决定:**是保留自建 session + 让 Portal 端暴露一个 JWKS 让 Agent 信任?还是把用户体系完全迁到 Supabase Auth?**

#### A.3 决策点:Portal 用户体系迁移(必需)

**问题**:dev-login.jsx 走的是 `supabase.rpc('login_user', ...)` 自建 RPC,**不是 `supabase.auth.signInWithPassword()`**。这意味着 cookie `wgd_session` 不是 Supabase Auth 的 session。

**两条路**:

- **路 1:Portal 端暴露 JWKS,Agent 用 HS256 信任 portal**
  - Portal `/api/auth/jwks.json` 暴露一个 RS256 公钥对(新增)
  - Portal `/api/agent-token` 用对应私钥签 token(保留 HS256 友好 + 兼容)
  - Agent 改 `AGENT_JWKS_URL=https://portal/api/auth/jwks.json`
  - 优点:对现有用户体系零改动;Portal 完全控制 token
  - 缺点:Portal 多一个密钥对要管

- **路 2:用户体系迁到 Supabase Auth**
  - `pages/login.jsx` 改成 `supabase.auth.signInWithPassword()`
  - 前端用 `supabase.auth.onAuthStateChange` 维护 session
  - Portal `/api/agent-token` 取 `supabase.auth.getSession().access_token`
  - Agent 信任 Supabase JWKS(已就绪)
  - 优点:标准化,后续 OAuth/Magic Link 容易接
  - 缺点:登录页 + session 管理都要重写

**推荐**:路 1 —— 改动小、风险低;路 2 工作量大,且不在本期整改范围。

---

### 阶段 B:逐项联调(顺序,每项可独立验证)

#### B.1 WS 握手 + hello(无需 token,只验协议层)

**怎么测**:
```bash
node scripts/probe-agent-ws.mjs
# 期望:收到 hello {protocolVersion:1,sessionId:'srv'}
```

**已通过** ✅ —— 见 §1.1。

#### B.2 WS auth 第一帧(需要合法 token)

**前置**:A.1 + A.3 完成后

**怎么测**:
```bash
TOKEN=$(curl -s http://portal/api/agent-token | jq -r .token)
PROBE_TOKEN="$TOKEN" node scripts/probe-agent-ws.mjs
# 期望:hello 后,继续存活(不再 5s 关)
# 不期望:close 1008 invalid_token
```

#### B.3 user.message → ack → 流式回复

**前置**:B.2 通过

**怎么测**(扩展 probe 脚本):
- 连 WS,等 hello
- 发 auth(用合法 token)
- 发 `user.message {conversationId:null, content:'本月营收', messageId:uuid}`
- 期望收到(顺序):
  ```
  ack {messageId: <我们发的 uuid>}
  message_start {message:{id,model,usage}}
  content_block_start {index:0, content_block:{type:'text', text:''}}
  content_block_delta * N {delta:{type:'text_delta', text:'...'}}
  content_block_stop {index:0}
  message_delta {delta:{stop_reason:'end_turn'}}
  message_stop
  ```

#### B.4 error / refusal / rate_limit 分类

**怎么测**:
- 在 B.3 基础上,触发:
  - 改 API key 触发 auth 失败 → `error {code:'auth'}`
  - 发超大 content → `error {code:'bad_request'}` 或 `max_tokens` 截断
  - 触 refusal 内容(假数据不好造,跳过)

#### B.5 user.interrupt 中断

**前置**:B.3 通过

**怎么测**:
- 发 user.message(长内容)
- 流式回复到一半,发 `user.interrupt`
- 期望收到 `interrupted {conversationId, reason:'user'}`,stream 停止,token 不再消耗

#### B.6 HTTP `/api/conversations/:id/messages` 返回 ContentBlock[]

**前置**:A.2 完成

**怎么测**:
```bash
TOKEN=...
curl -H "Authorization: Bearer $TOKEN" \
  http://agent:4101/api/conversations/<existing-conv-id>/messages
# 期望:content 字段是 [{type, text/thinking/tool_use}, ...]
# 旧数据兼容:字符串 content 自动包成 [{type:'text', text:...}]
```

#### B.7 (可选)错误分类完整对照

按 [alignment-and-checklist.md §2.2](./alignment-and-checklist.md) 表格逐项验证:
- 触发 rate_limit → `error {code:'rate_limit', retry_after_ms}`
- 触发 auth → `error {code:'auth'}`
- 触发 permission → `error {code:'permission'}`
- 触发 not_found → `error {code:'not_found'}`
- 触发 refusal → `error {code:'refusal', category}`

---

### 阶段 C:跨端 UI 联调

**前置**:Portal dev agent 完成 §B.5/B.6/B.7(组件改造)+ 阶段 A、B 全过

**怎么测**:
1. Portal 部署(包含 `NEXT_PUBLIC_AGENT_WS_URL=ws://agent:4102`,不走 mock)
2. 浏览器打开 Portal `/chat`
3. 发消息,观察:
   - WS 连接 → header 显示"已连接"
   - 输入 → 打字机效果
   - 触发 refusal → 灰底提示框
   - 触发错误 → banner 显示
4. 验证 token 不再走 URL `?token=`(Network 面板里 WS upgrade request URL 应无 token 参数)
5. 历史会话打开后,assistant message 应按块渲染(text 走 MarkdownView、thinking 折叠、tool_use 卡片)

---

## 3. 当前可以独立完成的事

不依赖 Portal 端,以下我现在就能做:

### 3.1 修复 Agent alg

**预计时间**:5 分钟代码 + 重启 + 验证

`agent/src/channels/auth.ts` 改 `algorithms: ['RS256']` → `['RS256', 'ES256']`

需要确认:
- VM 上 Agent 是怎么启动的(systemd service 名 / systemd unit 路径)
- 重启方式:`systemctl restart wdg-agent`?

### 3.2 写完整的 probe 脚本

**预计时间**:30 分钟

写一个 `scripts/probe-agent-ws-full.mjs`,支持:
- 自动从 Supabase 签发 token(用 service_role key,但我们没有)
- 或者:从 Portal `/api/agent-token` 拿(需 Portal 端启动)
- 或者:接受手动传入 token

**退路**:写一个"半自动"probe —— 接受外部 token + 跑完整握手/auth/message/dump 流。

### 3.3 修 Portal `/api/sessions/*` 不签 token,直接转发 cookie

**预计时间**:1 小时

如果走"路 1"(portal 端 JWKS + 自签),这块改动是:
- `pages/api/auth/jwks.json.js` 新增(暴露公钥)
- `pages/api/sessions/*.js` 改成调 `signAgentToken` 不变(因为还是走 portal 的自签,只是把 supabase jwks 换成 portal jwks)
- Agent 改 `AGENT_JWKS_URL` 指向 portal 这个端点

如果走"路 2"(Supabase Auth),改动更大(登录页要重写)。

---

## 4. 提议的下一步

**推荐路径**(我来做):

1. **现在**(10 分钟):
   - 修 Agent `auth.ts` 的 alg(`['RS256', 'ES256']`)
   - 重启 Agent,验证 hello / fake-token-close 行为不变
   - 跑 B.1 ✅

2. **下一步**(1 小时,等用户决策):
   - **如果选路 1(Portal JWKS)**:写 portal `/api/auth/jwks.json`,改 portal `/api/sessions/*` 不签自签 token(保持),改 Agent `AGENT_JWKS_URL` 指 portal
   - **如果选路 2(Supabase Auth 迁移)**:把当前任务挂起,等 Portal dev agent 决定

3. **然后**(半天):
   - 跑 B.2 - B.7 全套联调
   - 写联调报告

**等用户确认**:
- 走路 1 还是路 2?
- Agent 重启方式是 `systemctl restart wdg-agent` 吗?
- 测试用的 Supabase user(可能是 wgd_admin@...)—— 我能用现成的吗,还是要新建?

---

## 5. 已知遗留

1. Portal 仓库我的 ChatShell.tsx 还在 mock 模式(`NEXT_PUBLIC_USE_MOCK_AGENT=1`)。切真 Agent 只需 env 改 0。
2. Portal 当前没起服务(curl 3000 无响应)。要跑 UI 联调,需要 portal dev agent 启动新代码。
3. Agent 端 Phase 0 止血(去 `temperature` + 改 adaptive)从 commit log 看已合。Portal 端我自己的改动阶段 1 联调清单已经过(mock 端)。

---

## 6. 附录:已跑通的探针

### 6.1 `scripts/probe-agent-ws.mjs`

纯 Node 22 内置 WebSocket,无依赖。
- 不带 token:1 帧 hello + 5s 超时关(确认协议层 + 超时行为)
- 带 fake token:close 1008 invalid_token

### 6.2 HTTP 401 矩阵

| 场景 | 状态码 |
|---|---|
| 无 auth | 401 |
| `Bearer garbage` | 401 |
| `Bearer <HS256 token with SUPABASE_JWT_SECRET>` | 401(alg 不匹配) |
| `Bearer <ES256 token from Supabase Auth>` | **未测**(改 alg 后可测) |

### 6.3 期望最终形态(假设选路 1)

```
[浏览器] ─cookie─▶ Portal
   │           │
   │           ├─ /api/auth/jwks.json: RS256 公钥(portal 自签的)
   │           │
   │           └─ /api/sessions/*: 调 signAgentToken(portal 私钥) → Agent
   │
   │  WS 直连(无 ?token=)
   ▼
[Agent] ─JWKS─▶ Portal /api/auth/jwks.json(验 portal 自签 token)
```