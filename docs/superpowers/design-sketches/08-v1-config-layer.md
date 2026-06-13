# WDG v1 — 配置层结构图 (Agent 为主)

> 回答 "原来 UI 中的 chat 用了同一套配置么, 它在哪一层" 这个问题的延续。
> 现状 (v0) 的配置散落在 Next.js 进程内,v1 全部归到 Agent Service。

## 1. v0 现状:配置全在 Next.js 进程内

```
┌─────────────────── Next.js 进程 (port 4100) ───────────────────────┐
│                                                                     │
│  ┌── Agent Config 集群 (现状全在这里) ──────────────────────┐     │
│  │                                                             │     │
│  │  ui/src/lib/chat/agent.md                                  │     │
│  │     · 业务术语 / 回答风格 (管理员可编辑的模板)             │     │
│  │                                                             │     │
│  │  ui/src/lib/chat/agent-config-store.ts                     │     │
│  │     · AgentConfigParams (7 个 LLM 调试参数)                │     │
│  │       maxTokens / temperature / topP /                     │     │
│  │       maxToolChainDepth / rateLimitMaxPerMinute /          │     │
│  │       tokenSoftLimit / tokenHardLimit /                    │     │
│  │       mcpRetryMaxAttempts / thinkingLevel                  │     │
│  │     · Credentials: baseURL / apiKey / model                │     │
│  │     · globalThis 单例 (跨 HMR 共享)                       │     │
│  │                                                             │     │
│  │  ui/src/lib/chat/prompt.ts                                 │     │
│  │     · buildSystemPrompt(ctx, tools, options)               │     │
│  │     · 硬编码的 4 段规则字符串:                              │     │
│  │       - GENERAL_RULES_FULL / _COMPACT                      │     │
│  │       - TOOL_USAGE_CONVENTIONS (wdg-data-platform skill)    │     │
│  │       - BANK_RULE (bank-classification skill)              │     │
│  │       - FINANCIAL_RATE_RULE (financial-rates skill)        │     │
│  │       - FORBIDDEN (forbidden-shortcuts skill)              │     │
│  │                                                             │     │
│  │  ui/src/lib/chat/secret-crypto.ts                          │     │
│  │     · apiKey/baseURL 加密存储                              │     │
│  │                                                             │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  /api/chat/route.ts  (13KB, 唯一的消费方)                            │
│     · 读 store → 拼 system prompt → 调 Anthropic → 流式输出         │
│                                                                     │
│  /api/admin/agent-config/route.ts                                    │
│     · GET  → 返回当前 store 内容                                    │
│     · POST → 写 agent.md + 更新 store                                │
│                                                                     │
│  /u/admin/agent-config/page.tsx  (Admin UI)                          │
│     · 编辑 agent.md / 调 7 个参数 / 保存                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

问题:
- 配置和调用方绑死, 任何 "在 Next.js 之外用 Agent" 都要重新建一套
- prompt.ts 的规则字符串不能独立升级, 必须改代码+重新部署
- Admin UI / Chat / 配置文件三者高度耦合在同一个进程
```

## 2. v1 目标:配置归 Agent Service,Admin UI 通过 HTTP 改

```
┌────────────────── Next.js UI (port 4100) ─────────────────────────┐
│                                                                     │
│  /u/admin/agent-config/page.tsx  (保留, 但改成调 Agent Service)    │
│     │                                                               │
│     │  HTTP:  GET/POST  http://agent:4101/api/admin/config         │
│     ▼                                                               │
│  /api/admin/agent-config-proxy/route.ts   (★ 新增, 仅 5 行代理)    │
│                                                                     │
│  ChatDrawer.tsx  (保留, 改 endpoint 到 ws://agent:4101/ws)         │
│     │                                                               │
│     │  WS:    ws://agent:4101/ws                                    │
│     ▼                                                               │
│                                                                     │
│  ❶ 不再持有任何配置  ❷ 不再直连 Anthropic  ❸ 唯一职责: 转发请求     │
│                                                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               │ HTTP / WebSocket
                               ▼
┌────────────────── Agent Service (port 4101)  ★ 唯一配置持有者 ─────┐
│                                                                     │
│  ┌── Config Store (★ 这里是配置的"家") ────────────────────────┐   │
│  │                                                              │   │
│  │  agent/src/config/store.ts                                   │   │
│  │  · 从 v0 的 agent-config-store.ts 整体迁过来                 │   │
│  │  · 同样用 globalThis 单例                                     │   │
│  │  · 同样支持热生效 (下一个请求生效)                            │   │
│  │                                                              │   │
│  │  内容:                                                       │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  agentMd: string              ← agent.md 文件内容     │   │   │
│  │  │  params.maxTokens             ← LLM 调试参数 (7 个)   │   │   │
│  │  │  params.temperature                                      │   │   │
│  │  │  params.topP                                            │   │   │
│  │  │  params.maxToolChainDepth                               │   │   │
│  │  │  params.rateLimitMaxPerMinute                           │   │   │
│  │  │  params.tokenSoftLimit / tokenHardLimit                 │   │   │
│  │  │  params.mcpRetryMaxAttempts                             │   │   │
│  │  │  params.thinkingLevel  (off/low/medium/high)            │   │   │
│  │  │  baseURL: string | null                                 │   │   │
│  │  │  apiKey:  string | null    (secret-crypto 加密)        │   │   │
│  │  │  model:   string          (default: claude-opus-4-8)   │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── Prompt Builder (★ 规则的"家") ─────────────────────────────┐   │
│  │                                                              │   │
│  │  agent/src/agent/prompt.ts  (从 v0 整体迁过来)              │   │
│  │     · buildSystemPrompt(ctx, tools, options)                │   │
│  │                                                              │   │
│  │  agent/src/skills/loader.ts                                │   │
│  │     · 启动时扫 agent/skills/*.md                            │   │
│  │     · Y 方案: description 常驻, 调 load_skill() 展开全文    │   │
│  │                                                              │   │
│  │  agent/skills/                                              │   │
│  │     · wdg-data-platform.md   (← TOOL_USAGE_CONVENTIONS)    │   │
│  │     · bank-classification.md (← BANK_RULE)                 │   │
│  │     · financial-rates.md    (← FINANCIAL_RATE_RULE)        │   │
│  │     · forbidden-shortcuts.md (← FORBIDDEN)                 │   │
│  │     · general-rules.md      (← GENERAL_RULES_*)            │   │
│  │     · agent-base.md         (← agent.md 的角色 + 业务)     │   │
│  │     · weekly-bank-review.md  (★ 新增, v1 业务 skill)       │   │
│  │     · monthly-financial-summary.md  (★ 新增)               │   │
│  │     · ... 5 个业务 skill (v1 范围)                          │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── Consumer (★ 唯一的调用方) ─────────────────────────────────┐   │
│  │                                                              │   │
│  │  agent/src/agent/runner.ts  (从 v0 的 /api/chat/route.ts    │   │
│  │                              拆出来 + 重写)                  │   │
│  │     · 读 ConfigStore.get() 拿当前配置                        │   │
│  │     · 拼 system prompt (业务指令 + skill + 工具)             │   │
│  │     · 调 Anthropic SDK                                       │   │
│  │     · 流式输出                                                │   │
│  │     · 工具调用循环                                            │   │
│  │     · Token 监控 / Rate limit (用 ConfigStore 的参数)        │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── Admin API (★ 唯一的写入方) ────────────────────────────────┐   │
│  │                                                              │   │
│  │  agent/src/api/admin/config/route.ts                        │   │
│  │     · GET  /api/admin/config → 返回当前 store 内容          │   │
│  │     · POST /api/admin/config → 更新 store + 写 agent.md     │   │
│  │     · POST /api/admin/config/reset → 重置回默认              │   │
│  │     · permission check (调 Next.js 鉴权: 通过 header 透传)  │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 数据流对比 (v0 vs v1)

### v0: 改配置

```
Admin 在 /u/admin/agent-config 改 maxTokens
   │
   ▼
POST /api/admin/agent-config   (Next.js 进程)
   │
   ├─ 写 ui/src/lib/chat/agent.md (磁盘)
   ├─ 改 in-memory store (globalThis 单例)
   └─ 返回
   │
   ▼
下一次 /api/chat 请求:
   ├─ 读 store → 拿新 maxTokens
   ├─ 调 Anthropic 用新参数
   └─ 流式输出
```

### v1: 改配置

```
Admin 在 /u/admin/agent-config 改 maxTokens
   │
   ▼
POST /api/admin/agent-config-proxy   (Next.js 进程, 5 行代理)
   │
   │  fetch POST http://agent:4101/api/admin/config
   ▼
Agent Service admin API
   │
   ├─ 写 agent/agent.md (磁盘, 在 Agent 进程内)
   ├─ 改 ConfigStore (Agent 进程内 globalThis 单例)
   └─ 返回
   │
   ▼
下一次 WebSocket 连接 / Cron 任务 / 任何 Agent 内部调用:
   ├─ 读 ConfigStore.get() → 拿新 maxTokens
   ├─ 调 Anthropic 用新参数
   └─ 流式输出
```

## 4. 关键不变量 — "同一套配置"在 v1 的命运

**v0 散落在 4 处的配置, v1 全部归到 Agent Service 一个 store**:

| 配置                | v0 位置 (Next.js)                  | v1 位置 (Agent Service)              | 调用方           |
|---------------------|------------------------------------|--------------------------------------|------------------|
| 业务指令 (agent.md) | `ui/src/lib/chat/agent.md`         | `agent/agent.md`                     | PromptBuilder    |
| LLM 调试参数 (7 个) | `agent-config-store.ts` 内         | `agent/src/config/store.ts` 内        | AgentRunner      |
| Credentials         | `agent-config-store.ts` 内         | `agent/src/config/store.ts` 内        | AgentRunner      |
| System prompt 模板  | `prompt.ts` 硬编码字符串            | `agent/src/agent/prompt.ts` +         | AgentRunner      |
|                     |                                    | `agent/skills/*.md` (Y 方案)         |                  |

**Admin UI 是配置的唯一外部入口** (人 → 配置), **AgentRunner 是配置的唯一内部消费方** (配置 → 行为)。

## 5. 改动清单 (v0 → v1 跟"配置"相关的)

### 5.1 Agent Service 侧 (新增代码)

| 文件 | 来源 | 工作量 |
|---|---|---|
| `agent/src/config/store.ts` | 从 `ui/src/lib/chat/agent-config-store.ts` 复制并适配 | 0.5 天 |
| `agent/src/config/secret-crypto.ts` | 从 `ui/src/lib/chat/secret-crypto.ts` 复制 | 0.2 天 |
| `agent/src/agent/prompt.ts` | 从 `ui/src/lib/chat/prompt.ts` 复制 + 改类型 | 0.3 天 |
| `agent/src/api/admin/config/route.ts` | 新增, 镜像 v0 的 admin API | 0.3 天 |
| `agent/skills/*.md` (5 个) | 从 prompt.ts 的硬编码字符串抽出 | 0.5 天 |
| `agent/agent.md` (角色 + 业务) | 从 `ui/src/lib/chat/agent.md` 复制 | 0.1 天 |
| **小计** | | **~2 天** |

### 5.2 Next.js 侧 (改造)

| 文件 | 改动 | 工作量 |
|---|---|---|
| `ui/src/lib/chat/agent-config-store.ts` | 标记 deprecated, 仅 admin proxy 用 | 0.1 天 |
| `ui/src/lib/chat/prompt.ts` | 标记 deprecated, 留给其他 fallback | 0.1 天 |
| `ui/src/lib/chat/secret-crypto.ts` | 同上 | 0.1 天 |
| `ui/src/app/api/admin/agent-config/route.ts` | 改为 5 行 fetch 代理 | 0.1 天 |
| `ui/src/components/admin/AgentConfigEditor.tsx` | 改调 proxy endpoint, UI 不变 | 0.2 天 |
| `ui/src/components/admin/AgentConfigPreview.tsx` | 不变 | 0 天 |
| `ui/src/app/u/admin/agent-config/page.tsx` | 不变 | 0 天 |
| **小计** | | **~0.6 天** |

### 5.3 删除 (v1.1 收尾时再做, v1 内保留作为 fallback)

| 文件 | 何时删 |
|---|---|
| `ui/src/lib/chat/agent-config-store.ts` | v1.1, 当确认所有调用都走 Agent |
| `ui/src/lib/chat/prompt.ts` | v1.1 |
| `ui/src/lib/chat/secret-crypto.ts` | v1.1 (但 secret-crypto 模块搬到 agent 复用) |

## 6. 这个图你看到了什么

1. **配置 100% 集中到 Agent Service** — 单一来源, 单一消费方, 单一写入方
2. **UI 进程只做代理** — 5 行 fetch, 不持任何配置
3. **Y 方案 Skill 文件就是 prompt.ts 字符串的"搬家"** — 内容已经在 v0 里, 我们只是从硬编码字符串变成 .md 文件
4. **v0 现状不是"从零开始", 而是"挪窝"** — 工作量很小 (~2.5 天), 因为现状已经 80% 正确

**v0 现状的本质问题不是"设计错了", 而是 "Agent 还没有独立进程". 我们的方案 2 就是给 Agent 一个独立的家, 然后把配置 (跟 Agent 强相关的数据) 跟着搬过去.**
