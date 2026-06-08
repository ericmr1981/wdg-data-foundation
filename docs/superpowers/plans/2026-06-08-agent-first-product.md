# WDG Agent-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 WDG Data Foundation 演化成"以 Agent 为主的企业数据管理产品"—— Agent 独立服务 (Node.js, port 4101), 具备 5 个 Skill、定时巡检、任务队列、短期记忆; ChatDrawer 改 ws://agent:4101/ws; 5 阶段切流上线.

**Architecture:** B 模式 (Agent 独立服务). Agent Service 是 Node.js + Fastify + ws, DB-backed 任务队列, Skill 文件系统 + Y 方案按需加载, 复用既有 45 MCP tools 通过 `/api/mcp` 调. v0 chat fallback 保留 4 周.

**Tech Stack:** Node.js 20, TypeScript, Fastify, ws, @anthropic-ai/sdk, pg, gray-matter, prom-client, node:test, tsx. **不动**: Python ETL, 既有 45 MCP tools, Metabase, 既有业务表.

**Reference Spec:** [../specs/2026-06-08-agent-first-product.md](../specs/2026-06-08-agent-first-product.md)

**Worktree:** 当前在 `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/agent-first-product`, 分支 `worktree-agent-first-product`. 所有 git 命令相对 worktree 根目录跑.

---

## File Structure

```
agent/                              # ★ 新增目录 (Node.js 项目)
├── package.json
├── tsconfig.json
├── .env.example
├── Dockerfile
├── src/
│   ├── server.ts                   # Fastify 入口
│   ├── config.ts                   # 环境变量
│   ├── db.ts                       # pg.Pool
│   ├── errors.ts                   # AgentError 体系
│   ├── config/
│   │   ├── store.ts                # ConfigStore (v0 复制)
│   │   ├── store.test.ts
│   │   ├── secret-crypto.ts        # 加密 apiKey (v0 复制)
│   │   ├── secret-crypto.test.ts
│   │   └── agent-md-loader.ts
│   ├── channels/
│   │   ├── types.ts                # IncomingMsg / OutgoingMsg / Channel 接口
│   │   ├── manager.ts              # ChannelManager
│   │   ├── manager.test.ts
│   │   ├── web.ts                  # WebChannel (WebSocket)
│   │   ├── web.test.ts
│   │   ├── cron.ts                 # CronChannel
│   │   └── cron.test.ts
│   ├── conversation/
│   │   ├── manager.ts              # ConversationManager
│   │   └── manager.test.ts
│   ├── skills/
│   │   ├── types.ts                # Skill / SkillFrontmatter
│   │   ├── loader.ts               # 扫 *.md
│   │   ├── registry.ts             # 内存 Map + get/list
│   │   ├── registry.test.ts
│   │   └── load-skill-tool.ts      # load_skill 工具
│   ├── mcp/
│   │   ├── bridge.ts               # 调 /api/mcp
│   │   └── bridge.test.ts
│   ├── agent/
│   │   ├── runner.ts               # LLM 循环
│   │   ├── runner.test.ts
│   │   └── prompt.ts               # system prompt 拼装
│   ├── tasks/
│   │   ├── types.ts
│   │   ├── scheduler.ts            # DB-backed queue
│   │   ├── scheduler.test.ts
│   │   ├── registry.ts             # 任务类型注册
│   │   └── handlers/
│   │       └── weekly-bank-review.ts
│   ├── notifications/
│   │   ├── notifier.ts             # 抽象
│   │   └── web-push.ts             # Web 实现
│   ├── audit/
│   │   └── logger.ts
│   ├── api/
│   │   ├── auth-middleware.ts
│   │   ├── error-handler.ts
│   │   └── admin/
│   │       └── config.ts           # admin config API
│   ├── metrics/
│   │   └── server.ts               # /metrics
│   └── health.ts
├── skills/                          # ★ 5 个 skill 文件
│   ├── wdg-data-platform.md
│   ├── bank-classification.md
│   ├── financial-rates.md
│   ├── forbidden-shortcuts.md
│   ├── agent-base.md               # ← v0 agent.md 角色 + 业务
│   └── weekly-bank-review.md
└── test/
    └── helpers/
        ├── mock-anthropic.ts
        ├── mock-mcp.ts
        └── mock-db.ts

sql/
└── 00_agent_schema.sql             # ★ 新增 (conversations / messages / tasks / task_steps / audit_log)

ui/                                 # 既有, 小改
├── src/
│   ├── lib/chat/
│   │   ├── agent-config-store.ts   # MARK deprecated (保留 v0, 走 admin proxy)
│   │   ├── prompt.ts               # MARK deprecated
│   │   └── secret-crypto.ts        # MARK deprecated (模块搬到 agent 复用)
│   ├── app/api/
│   │   ├── admin/agent-config/route.ts    # 改为 5 行 fetch 代理
│   │   └── chat/route.ts                  # 保留 v0 作为 fallback
│   ├── components/chat/
│   │   ├── ChatDrawer.tsx                # 改 endpoint, 保留 fallback
│   │   └── ChatWidget.tsx                # 不变
│   └── app/u/
│       └── notifications/
│           └── page.tsx                  # ★ 新增

docker-compose.yml                  # 加 agent service
.env.example                        # 加 AGENT 相关 env
```

---

## 关键约定 (供所有 task 引用)

- **所有 task 都跑** 在 worktree 内, 路径相对 worktree 根
- **所有 TypeScript 文件** 走 ESM (package.json `"type": "module"`)
- **测试** 用 `node:test` + `tsx`, 跟 v0 一致
- **L1 oracle**: `cd agent && npx tsc --noEmit` 必须在每个 task 通过
- **L1 oracle (SQL)**: `psql $DATABASE_URL -f sql/00_agent_schema.sql` 必须 idempotent
- **既有项目不退化**: 每个 W 末尾跑 `pytest tests/ -v` (Python) + `cd ui && npx next build` (UI)

---

## 5 周排期

| 周 | Task 范围 | 关键里程碑 |
|---|---|---|
| W1 | Task 1-6 (脚手架 + DDL + Channel + Conversation) | Agent 起, Web Channel 跑通, Conversation 持久化 |
| W2 | Task 7-11 (Skill + load_skill + ChatDrawer 改 endpoint) | ChatDrawer 走 ws://agent, weekly-bank-review 跑通 |
| W3 | Task 12-16 (MCP Bridge + 5 Skill 补全 + Runner) | 5 skill 跑通真实数据, LLM 循环稳定 |
| W4 | Task 17-21 (TaskScheduler + Cron + Notifier) | 周一 9 点自动巡检, 进度推 UI |
| W5 | Task 22-26 (E2E + 监控 + 文档 + 部署) | Shadow mode 上线 |

---

# W1 — 脚手架 + 基础组件

## Task 1: Agent Service 项目脚手架

**Files:**
- Create: `agent/package.json`
- Create: `agent/tsconfig.json`
- Create: `agent/.env.example`
- Create: `agent/Dockerfile`
- Create: `agent/.gitignore`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "wdg-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "node --import tsx src/server.ts",
    "build": "tsc",
    "test": "node --import tsx --test 'src/**/*.test.ts'",
    "test:integration": "node --import tsx --test 'test/integration/**/*.test.ts'",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/websocket": "^11.0.0",
    "fastify": "^5.0.0",
    "gray-matter": "^4.0.3",
    "node-cron": "^3.0.3",
    "pg": "^8.13.0",
    "prom-client": "^15.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "@types/pg": "^8.11.0",
    "pg-mem": "^3.0.4",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "allowImportingTsExtensions": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: 写 .env.example**

```bash
# Agent Service
WS_PORT=4101
DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db:5432/wdg
MCP_ENDPOINT=http://ui:4100/api/mcp
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=
ANTHROPIC_MODEL=claude-opus-4-8

# Cron
CRON_TIMEZONE=Asia/Shanghai
CRON_WEEKLY_REVIEW=0 9 * * 1
CRON_MONTHLY_SUMMARY=0 10 1 * *

# Task queue
TASK_WORKER_COUNT=4

# Logging
LOG_LEVEL=info
```

- [ ] **Step 4: 写 Dockerfile**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY skills/ ./skills/
COPY agent.md ./agent.md
EXPOSE 4101
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://localhost:4101/health || exit 1
CMD ["node", "dist/server.js"]
```

- [ ] **Step 5: 写 .gitignore**

```
node_modules/
dist/
.env
.env.local
*.log
coverage/
```

- [ ] **Step 6: 安装依赖 + 验证**

```bash
cd agent
npm install
```

Expected: 安装成功, 无 error

- [ ] **Step 7: 跑 type-check 确认配置 OK**

```bash
cd agent
mkdir -p src
echo "export const x: number = 1" > src/_smoke.ts
npx tsc --noEmit
echo "OK"
```

Expected: `OK`

- [ ] **Step 8: 删除 smoke 文件, commit**

```bash
cd agent
rm src/_smoke.ts
cd ..
git add agent/package.json agent/tsconfig.json agent/.env.example agent/Dockerfile agent/.gitignore
git commit -m "feat(agent): 项目脚手架 — package.json, tsconfig, Dockerfile"
```

---

## Task 2: DDL — `agent.*` schema

**Files:**
- Create: `sql/00_agent_schema.sql`

- [ ] **Step 1: 写 SQL 文件**

```sql
-- sql/00_agent_schema.sql
-- Agent Service 数据层 (conversations / messages / tasks / task_steps / audit_log)
-- Idempotent — 可重复跑

CREATE SCHEMA IF NOT EXISTS agent;

-- ─── 短期记忆: 会话 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  brand             TEXT,
  channel_id        TEXT NOT NULL,                -- 'web' | 'cron'
  status            TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  summary           TEXT,                          -- LLM 压缩
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_user_active
  ON agent.conversations(user_id, last_active_at DESC);

-- ─── 短期记忆: 消息 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.messages (
  message_id        BIGSERIAL PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES agent.conversations(conversation_id) ON DELETE CASCADE,
  role              TEXT NOT NULL,                -- 'user' | 'assistant' | 'tool' | 'system'
  content           TEXT NOT NULL,
  tool_calls        JSONB,
  tool_results      JSONB,
  thinking          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_conv
  ON agent.messages(conversation_id, message_id);

-- ─── 任务队列: 任务 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.tasks (
  task_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id    UUID REFERENCES agent.tasks(task_id),
  conversation_id   UUID,
  user_id           TEXT,
  task_type         TEXT NOT NULL,                -- 'weekly_bank_review' | ...
  input             JSONB,
  status            TEXT NOT NULL DEFAULT 'QUEUED',  -- NEW|QUEUED|RUNNING|DONE|FAILED|CANCELLED|PARTIAL
  progress          INT NOT NULL DEFAULT 0,
  result            JSONB,
  error             JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created
  ON agent.tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user
  ON agent.tasks(user_id, created_at DESC);

-- ─── 任务队列: 步骤 ─────────────────────
CREATE TABLE IF NOT EXISTS agent.task_steps (
  step_id           BIGSERIAL PRIMARY KEY,
  task_id           UUID NOT NULL REFERENCES agent.tasks(task_id) ON DELETE CASCADE,
  step_index        INT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|RUNNING|DONE|FAILED|SKIPPED
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  result            JSONB,
  error             JSONB,
  UNIQUE(task_id, step_index)
);

-- ─── 审计 ──────────────────────────────
CREATE TABLE IF NOT EXISTS agent.audit_log (
  log_id            BIGSERIAL PRIMARY KEY,
  user_id           TEXT,
  conversation_id   UUID,
  task_id           UUID,
  action            TEXT NOT NULL,                -- 'llm.call' | 'mcp.call' | 'task.enqueue' | 'error' | ...
  payload           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user
  ON agent.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON agent.audit_log(action, created_at DESC);
```

- [ ] **Step 2: 验证 SQL 跑通 (idempotent 跑两次)**

```bash
# 跑第一次
PGPASSWORD=$DB_PASSWORD psql -h db -U postgres -d wdg -f sql/00_agent_schema.sql 2>&1 | tail -5
# 跑第二次 (应该没 error)
PGPASSWORD=$DB_PASSWORD psql -h db -U postgres -d wdg -f sql/00_agent_schema.sql 2>&1 | tail -5
```

Expected: 两次都 `CREATE SCHEMA / CREATE TABLE` 提示或 `NOTICE: ... already exists`, 不应 error

- [ ] **Step 3: 验证 5 张表都建好**

```bash
PGPASSWORD=$DB_PASSWORD psql -h db -U postgres -d wdg -c "\dt agent.*"
```

Expected: 5 张表 (conversations, messages, tasks, task_steps, audit_log)

- [ ] **Step 4: Commit**

```bash
git add sql/00_agent_schema.sql
git commit -m "feat(sql): agent schema — conversations/messages/tasks/task_steps/audit_log"
```

---

## Task 3: ConfigStore (v0 整体迁移)

**Files:**
- Create: `agent/src/config/store.ts`
- Create: `agent/src/config/store.test.ts`

- [ ] **Step 1: 写测试**

```ts
// agent/src/config/store.test.ts
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  getAgentConfig, setAgentMd, setParam, setParams,
  setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS,
  thinkingConfigFor, THINKING_BUDGET,
} from './store.ts'

test('DEFAULT_PARAMS has expected values', () => {
  assert.equal(DEFAULT_PARAMS.maxTokens, 4096)
  assert.equal(DEFAULT_PARAMS.temperature, 0.3)
  assert.equal(DEFAULT_PARAMS.maxToolChainDepth, 10)
  assert.equal(DEFAULT_PARAMS.tokenSoftLimit, 80_000)
  assert.equal(DEFAULT_PARAMS.tokenHardLimit, 200_000)
  assert.equal(DEFAULT_PARAMS.thinkingLevel, 'off')
})

test('THINKING_BUDGET maps correctly', () => {
  assert.equal(THINKING_BUDGET.low, 1024)
  assert.equal(THINKING_BUDGET.medium, 8192)
  assert.equal(THINKING_BUDGET.high, 16384)
})

test('thinkingConfigFor returns null for off', () => {
  assert.equal(thinkingConfigFor('off'), null)
})

test('thinkingConfigFor returns config for medium', () => {
  const c = thinkingConfigFor('medium')
  assert.deepEqual(c, { type: 'enabled', budget_tokens: 8192 })
})

test('defaultConfig initializes with DEFAULT_PARAMS', () => {
  resetAgentConfig()
  const cfg = getAgentConfig()
  assert.equal(cfg.model, 'claude-opus-4-8')
  assert.equal(cfg.baseURL, null)
  assert.equal(cfg.apiKey, null)
  assert.equal(cfg.params.temperature, 0.3)
})

test('setAgentMd updates content', () => {
  setAgentMd('# new content')
  assert.equal(getAgentConfig().agentMd, '# new content')
  resetAgentConfig()  // cleanup
})

test('setParam updates single param', () => {
  setParam('temperature', 0.7)
  assert.equal(getAgentConfig().params.temperature, 0.7)
  resetAgentConfig()
})

test('setParams updates multiple', () => {
  setParams({ temperature: 0.5, maxTokens: 8192 })
  const cfg = getAgentConfig()
  assert.equal(cfg.params.temperature, 0.5)
  assert.equal(cfg.params.maxTokens, 8192)
  resetAgentConfig()
})

test('setCredentialConfig updates baseURL/apiKey/model', () => {
  setCredentialConfig('https://api.test', 'sk-test', 'claude-sonnet-4-6')
  const cfg = getAgentConfig()
  assert.equal(cfg.baseURL, 'https://api.test')
  assert.equal(cfg.apiKey, 'sk-test')
  assert.equal(cfg.model, 'claude-sonnet-4-6')
  resetAgentConfig()
})
```

- [ ] **Step 2: 跑测试, 确认 fail**

```bash
cd agent
npm test -- src/config/store.test.ts 2>&1 | tail -10
```

Expected: FAIL (Module not found ./store.ts)

- [ ] **Step 3: 写 ConfigStore 实现**

```ts
// agent/src/config/store.ts
// ConfigStore — Agent 进程内的配置存储 (复制自 v0 ui/src/lib/chat/agent-config-store.ts)
// 保持 API 兼容, 单一来源, 进程内 in-memory, 鉴权由 admin API 调用方负责

// ─── 类型 ───────────────────────────

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export const THINKING_BUDGET: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  low: 1024,
  medium: 8192,
  high: 16384,
}

export interface ThinkingConfigParam {
  type: 'enabled'
  budget_tokens: number
}

export function thinkingConfigFor(level: ThinkingLevel): ThinkingConfigParam | null {
  if (level === 'off') return null
  return { type: 'enabled', budget_tokens: THINKING_BUDGET[level] }
}

export interface AgentConfigParams {
  maxTokens: number
  temperature: number
  topP: number | null
  maxToolChainDepth: number
  rateLimitMaxPerMinute: number
  tokenSoftLimit: number
  tokenHardLimit: number
  mcpRetryMaxAttempts: number
  thinkingLevel: ThinkingLevel
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
  thinkingLevel: 'off',
}

export interface AgentConfig {
  agentMd: string
  params: AgentConfigParams
  baseURL: string | null
  apiKey: string | null
  model: string
}

function loadDefaultAgentMd(): string {
  // 简化: 启动时 agent 目录应该有 agent.md
  // v0 是从 ui/src/lib/chat/agent.md 读
  // v1 从 agent/agent.md 读 (Task 7 之后才有这个文件, 这里先 fallback)
  return '# 项目级 Agent 指令\n\n（默认 agent.md 占位, Task 7 替换）\n'
}

function defaultConfig(): AgentConfig {
  return {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: process.env.ANTHROPIC_BASE_URL ?? null,
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
  }
}

// ─── globalThis 单例 (跨 HMR/重启) ──────

type AgentConfigSlot = { current: AgentConfig }
const SLOT_KEY = '__wdg_agent_config__'
const g = globalThis as unknown as { [SLOT_KEY]?: AgentConfigSlot }
const slot: AgentConfigSlot = (g[SLOT_KEY] ??= { current: defaultConfig() })

// ─── 读 ─────────────────────────────

export function getAgentConfig(): AgentConfig { return slot.current }
export function getBaseURL(): string | null { return slot.current.baseURL }
export function getApiKey(): string | null { return slot.current.apiKey }
export function getModel(): string { return slot.current.model }

// ─── 写 ─────────────────────────────

export function setAgentMd(content: string): void {
  slot.current = { ...slot.current, agentMd: content }
}

export function setParam<K extends keyof AgentConfigParams>(
  key: K,
  value: AgentConfigParams[K],
): void {
  slot.current = { ...slot.current, params: { ...slot.current.params, [key]: value } }
}

export function setParams(params: Partial<AgentConfigParams>): void {
  slot.current = { ...slot.current, params: { ...slot.current.params, ...params } }
}

export function setCredentialConfig(
  baseURL: string | null,
  apiKey: string | null,
  model: string,
): void {
  slot.current = { ...slot.current, baseURL, apiKey, model }
}

export function resetAgentConfig(): void {
  slot.current = defaultConfig()
}
```

- [ ] **Step 4: 跑测试, 确认 pass**

```bash
cd agent
npm test -- src/config/store.test.ts 2>&1 | tail -15
```

Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
cd agent
git add src/config/store.ts src/config/store.test.ts
git commit -m "feat(agent/config): ConfigStore — 从 v0 整体迁移, 全局单例"
```

---

## Task 4: 错误类型 + 通用 handler

**Files:**
- Create: `agent/src/errors.ts`

- [ ] **Step 1: 写 errors.ts**

```ts
// agent/src/errors.ts
// 5 类错误源: LLM / MCP / Task / Auth / System
// 统一接口, 方便 Fastify error handler 处理

export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
    public cause?: Error,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

// A. LLM 错误
export type LlmErrorCode = 'LLM_AUTH' | 'LLM_RATE_LIMIT' | 'LLM_OVERLOADED' | 'LLM_TIMEOUT' | 'LLM_BAD_REQUEST' | 'LLM_RETRY_EXHAUSTED'
export class LlmError extends AgentError {
  constructor(code: LlmErrorCode, message: string, retryable: boolean, cause?: Error) {
    super(code, message, retryable, cause)
    this.name = 'LlmError'
  }
}

// B. MCP 错误
export type McpErrorCode = 'MCP_TOOL_NOT_FOUND' | 'MCP_BAD_ARGS' | 'MCP_VIEW_NOT_READY' | 'MCP_DB_ERROR' | 'MCP_PERMISSION' | 'MCP_NETWORK'
export class McpError extends AgentError {
  constructor(code: McpErrorCode, message: string, retryable: boolean, cause?: Error) {
    super(code, message, retryable, cause)
    this.name = 'McpError'
  }
}

// C. Task 错误
export type TaskErrorCode = 'TASK_HANDLER_NOT_FOUND' | 'TASK_STEP_FAILED' | 'TASK_CANCELLED' | 'TASK_TIMEOUT' | 'TASK_WORKER_DIED'
export class TaskError extends AgentError {
  constructor(code: TaskErrorCode, message: string, retryable: boolean, cause?: Error) {
    super(code, message, retryable, cause)
    this.name = 'TaskError'
  }
}

// D. Auth 错误
export type AuthErrorCode = 'AUTH_REQUIRED' | 'AUTH_FORBIDDEN' | 'AUTH_INVALID_SESSION'
export class AuthError extends AgentError {
  constructor(code: AuthErrorCode, message: string) {
    super(code, message, false)
    this.name = 'AuthError'
  }
}

// E. System 错误
export type SystemErrorCode = 'SYS_DB_DOWN' | 'SYS_DISK_FULL' | 'SYS_INIT_FAILED'
export class SystemError extends AgentError {
  constructor(code: SystemErrorCode, message: string) {
    super(code, message, false)
    this.name = 'SystemError'
  }
}

// ─── 辅助: 从 Anthropic 错误映射 ───

export function mapAnthropicError(e: any): LlmErrorCode {
  const status = e?.status ?? e?.statusCode
  if (status === 401) return 'LLM_AUTH'
  if (status === 429) return 'LLM_RATE_LIMIT'
  if (status === 529 || status === 503) return 'LLM_OVERLOADED'
  if (status === 408 || status === 504) return 'LLM_TIMEOUT'
  if (status === 400) return 'LLM_BAD_REQUEST'
  return 'LLM_RETRY_EXHAUSTED'
}

// ─── 辅助: 从 MCP 错误映射 ───

export function mapMcpError(code: number): McpErrorCode {
  if (code === -32601) return 'MCP_TOOL_NOT_FOUND'  // Method not found
  if (code === -32602) return 'MCP_BAD_ARGS'         // Invalid params
  if (code === -32603) return 'MCP_DB_ERROR'         // Internal error
  if (code === 401 || code === 403) return 'MCP_PERMISSION'
  if (code === 502 || code === 503 || code === 504) return 'MCP_NETWORK'
  if (code === 42) return 'MCP_VIEW_NOT_READY'       // PG 42P01 等
  return 'MCP_DB_ERROR'
}
```

- [ ] **Step 2: Type check**

```bash
cd agent
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd agent
git add src/errors.ts
git commit -m "feat(agent/errors): 5 类错误源 + 映射辅助"
```

---

## Task 5: pg.Pool + 测试 helpers

**Files:**
- Create: `agent/src/db.ts`
- Create: `agent/test/helpers/mock-db.ts`

- [ ] **Step 1: 写 db.ts**

```ts
// agent/src/db.ts
import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not set')
    pool = new Pool({ connectionString: url, max: 10 })
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
```

- [ ] **Step 2: 写 mock-db.ts (pg-mem)**

```ts
// agent/test/helpers/mock-db.ts
import { newDb, IMemoryDb } from 'pg-mem'
import { readFileSync } from 'fs'
import { join } from 'path'

let memDb: IMemoryDb

export async function createTestDb() {
  memDb = newDb({ autoCreateForeignKeyIndices: true })
  const pg = memDb.adapters.createPg()
  const pool = new pg.Pool()

  // 跑 DDL (从仓库根相对路径)
  const ddlPath = join(process.cwd(), 'sql', '00_agent_schema.sql')
  const ddl = readFileSync(ddlPath, 'utf-8')
  await pool.query(ddl)

  return pool
}

export async function cleanupTestDb(pool: any) {
  await pool.query(`TRUNCATE agent.conversations, agent.messages, agent.tasks, agent.task_steps, agent.audit_log CASCADE`)
}
```

- [ ] **Step 3: Type check + 验证 mock-db 可用**

```bash
cd agent
# 临时加个 smoke 验证 pg-mem 能跑 DDL
cat > /tmp/smoke.test.ts << 'EOF'
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createTestDb } from './test/helpers/mock-db.ts'

test('createTestDb creates schema and tables', async () => {
  const pool = await createTestDb()
  const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'agent' ORDER BY table_name`)
  assert.equal(rows.length, 5)
  const names = rows.map((r: any) => r.table_name)
  assert.ok(names.includes('conversations'))
  assert.ok(names.includes('messages'))
  assert.ok(names.includes('tasks'))
  assert.ok(names.includes('task_steps'))
  assert.ok(names.includes('audit_log'))
})
EOF
cp /tmp/smoke.test.ts test/integration/smoke.test.ts
mkdir -p test/integration
mv test/integration/smoke.test.ts test/integration/smoke.test.ts 2>/dev/null || cp /tmp/smoke.test.ts test/integration/smoke.test.ts
npm test -- test/integration/smoke.test.ts 2>&1 | tail -10
rm test/integration/smoke.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd agent
git add src/db.ts test/helpers/mock-db.ts
git commit -m "feat(agent): pg.Pool + pg-mem 测试 helper"
```

---

## Task 6: WebChannel (WebSocket) + 基础 server

**Files:**
- Create: `agent/src/channels/types.ts`
- Create: `agent/src/channels/web.ts`
- Create: `agent/src/channels/web.test.ts`
- Create: `agent/src/server.ts`
- Create: `agent/src/health.ts`

- [ ] **Step 1: 写 channels/types.ts**

```ts
// agent/src/channels/types.ts
// Channel 抽象 — 所有消息来源走同一接口

export type ChannelId = 'web' | 'cron' | 'dingtalk' | 'webhook'

export interface IncomingMsg {
  channelId: ChannelId
  userId: string
  brand: string | null
  conversationId: string | null
  content: string
  attachments?: FileRef[]
  metadata?: Record<string, any>
}

export interface FileRef {
  name: string
  mimeType: string
  size: number
  url?: string
}

export type OutgoingType =
  | 'text_delta' | 'text_block' | 'thinking_delta'
  | 'tool_call' | 'tool_result' | 'task_update'
  | 'system_error' | 'done'

export interface OutgoingMsg {
  channelId: ChannelId
  conversationId: string
  type: OutgoingType
  payload: any
}

export interface Channel {
  channelId: ChannelId
  start(): Promise<void>
  stop(): Promise<void>
  send(msg: OutgoingMsg): Promise<void>
}
```

- [ ] **Step 2: 写 health.ts**

```ts
// agent/src/health.ts
import type { FastifyInstance } from 'fastify'
import { getPool } from './db.ts'

export async function registerHealth(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/ready', async (req, reply) => {
    try {
      await getPool().query('SELECT 1')
      return { status: 'ready' }
    } catch (e) {
      reply.code(503)
      return { status: 'not_ready', error: (e as Error).message }
    }
  })
}
```

- [ ] **Step 3: 写 server.ts (骨架, 还没接 WebChannel)**

```ts
// agent/src/server.ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import { registerHealth } from './health.ts'
import { WebChannel } from './channels/web.ts'
import { ChannelManager } from './channels/manager.ts'
// import 其他模块 (Task 7 之后补)

const PORT = parseInt(process.env.WS_PORT ?? '4101', 10)

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

  // Plugins
  await app.register(cors, { origin: true, credentials: true })
  await app.register(websocket)

  // Health
  await registerHealth(app)

  // WebChannel
  const webChannel = new WebChannel(PORT, /* manager 后面接 */ null as any)
  await webChannel.start()
  app.log.info(`WebChannel listening on ${PORT}`)

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('shutting down...')
    await webChannel.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: 写 channels/web.ts (ChannelManager 还没建, 先 stub)**

```ts
// agent/src/channels/web.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Channel, IncomingMsg, OutgoingMsg } from './types.ts'
import { ChannelManager } from './manager.ts'

interface Client {
  ws: WebSocket
  userId: string
  conversationId: string | null
}

export class WebChannel implements Channel {
  channelId = 'web' as const
  private wss: WebSocketServer
  private clients = new Map<WebSocket, Client>()

  constructor(
    private port: number,
    private manager: ChannelManager | null,
  ) {
    this.wss = new WebSocketServer({ port: this.port })
  }

  async start(): Promise<void> {
    this.wss.on('connection', (ws, req) => {
      // 鉴权: 从 query string 拿 userId (v0 header 走 Next.js; v1 简化, dev 先 trust)
      const url = new URL(req.url ?? '/', 'http://localhost')
      const userId = url.searchParams.get('userId') ?? 'anonymous'
      const conversationId = url.searchParams.get('conversationId')

      this.clients.set(ws, { ws, userId, conversationId })

      ws.on('message', async (raw) => {
        try {
          const data = JSON.parse(raw.toString())
          const msg: IncomingMsg = {
            channelId: 'web',
            userId,
            brand: data.brand ?? null,
            conversationId: data.conversationId ?? null,
            content: data.content ?? '',
            attachments: data.attachments,
            metadata: data.metadata,
          }
          if (this.manager) {
            await this.manager.onIncoming(msg)
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'system_error', payload: { code: 'BAD_INPUT', message: (e as Error).message } }))
        }
      })

      ws.on('close', () => { this.clients.delete(ws) })
      ws.on('error', () => { this.clients.delete(ws) })
    })
  }

  async send(msg: OutgoingMsg): Promise<void> {
    for (const [ws, client] of this.clients) {
      if (msg.conversationId && client.conversationId !== msg.conversationId) continue
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: msg.type, payload: msg.payload }))
      }
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }
}
```

- [ ] **Step 5: 写 channels/manager.ts (stub, Task 10 后补完)**

```ts
// agent/src/channels/manager.ts
// 入口: 收 IncomingMsg, 决定走 AgentRunner 即时对话 还是 TaskScheduler 长任务
// Task 10 之后: 接 AgentRunner; Task 17 之后: 接 TaskScheduler
import type { IncomingMsg } from './types.ts'

export class ChannelManager {
  async onIncoming(msg: IncomingMsg): Promise<void> {
    // v1 早期: echo 回, 验证链路
    console.log('[ChannelManager] received:', msg)
  }
}
```

- [ ] **Step 6: 跑 server, 验证能起**

```bash
cd agent
WS_PORT=4101 timeout 5 npx tsx src/server.ts 2>&1 | tail -10
```

Expected: `WebChannel listening on 4101`, 然后 5s 后退出

- [ ] **Step 7: 写 channels/web.test.ts (集成测试, 真实 WebSocket)**

```ts
// agent/src/channels/web.test.ts
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { WebChannel } from './web.ts'
import { ChannelManager } from './manager.ts'
import WebSocket from 'ws'

test('WebChannel accepts connection and receives messages', async () => {
  const port = 14201
  const received: any[] = []
  const manager = new ChannelManager()
  // mock: override onIncoming
  manager.onIncoming = async (msg) => { received.push(msg) }

  const channel = new WebChannel(port, manager)
  await channel.start()

  try {
    const ws = new WebSocket(`ws://localhost:${port}/?userId=test-user&conversationId=conv-1`)
    await new Promise<void>((resolve) => ws.once('open', resolve))

    ws.send(JSON.stringify({ content: 'hello', brand: 'yufeng' }))

    await new Promise(r => setTimeout(r, 200))

    assert.equal(received.length, 1)
    assert.equal(received[0].userId, 'test-user')
    assert.equal(received[0].content, 'hello')
    assert.equal(received[0].brand, 'yufeng')

    ws.close()
  } finally {
    await channel.stop()
  }
})
```

- [ ] **Step 8: 跑测试**

```bash
cd agent
npm test -- src/channels/web.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd agent
git add src/channels/ src/server.ts src/health.ts
git commit -m "feat(agent/channels): WebChannel (WebSocket) + 基础 server"
```

---

# W2 — Skill + load_skill + ChatDrawer 改 endpoint

## Task 7: Skill 文件系统 (5 个 .md + agent.md)

**Files:**
- Create: `agent/agent.md`
- Create: `agent/skills/wdg-data-platform.md`
- Create: `agent/skills/bank-classification.md`
- Create: `agent/skills/financial-rates.md`
- Create: `agent/skills/forbidden-shortcuts.md`
- Create: `agent/skills/weekly-bank-review.md`

- [ ] **Step 1: 写 agent/agent.md (从 v0 ui/src/lib/chat/agent.md 复制 + 略调)**

```markdown
# 项目级 Agent 指令

> 这里是 Agent 的"角色 + 业务术语 + 回答风格"。
> 通用规则 / 借贷方向 / 禁用工具由 skill 文件定义, 不要在这里重复。

## 业务术语

- 「上月」= Today 减去 1 个月
- 「同期」= 去年同月
- 蜜可诗 = brand_gelatomiiix
- 旺鼎阁 = bonjur
- 泰柯茶园 = brand_tamkoko

## 回答风格

- 始终用中文回答
- 数字四舍五入到万元
- 不主动展开未问的指标

## 调试说明

- 模型: claude-opus-4-8 (默认)
- 工具深度: 默认 10
- 重试: 默认 2 次
```

- [ ] **Step 2: 写 skills/wdg-data-platform.md**

```markdown
---
name: wdg-data-platform
description: |
  平台基础工具使用规范. 任何 LLM 调 MCP 工具前都应加载.
  涵盖品牌代码校验、期间解析、分类权限.
triggers:
  - "tool"
  - "MCP"
---

# WDG Data Platform Tool Conventions

## 品牌代码

调 `get_brand_stores` 前必须先确认品牌代码:
- gelatomiiix (蜜可诗): sh_sc, sh_xtd
- bonjur (旺鼎阁): sh_wdg, wz_ra, wz_wxc
- tamkoko (泰柯茶园): hz_fuyang, wz_bjwxc

## 期间解析

- 期间格式 YYYY-MM
- "本月" = Today 的 YYYY-MM
- "上月" = Today 减 1 个月
- "今天" = period 留空 (tool 默认)

ctx.period 是用户**当前查看的页面**的期间, 跟"用户想查的期间"不一定是同一个. 用户说"本月/上月/今天" 时, 以 Today 为准, 不要用 ctx.period.

## 分类权限

`submit_proposal` 只有 admin / finance / store_manager 能用. 如果用户是 operator 身份, 礼貌回"权限不足, 请联系 admin".
```

- [ ] **Step 3: 写 skills/bank-classification.md**

```markdown
---
name: bank-classification
description: |
  银行流水分类方向规则. 任何涉及银行流水分类推理时加载.
  定义 in/out 方向与类别的对应关系.
triggers:
  - "银行分类"
  - "流水"
  - "in_amt"
  - "out_amt"
---

# Bank Classification Direction Rule

## 核心规则

- `in_amt > 0` (money in) → 只用 `REV_BIZ` 或 `REV_OTHER` (收入类)
- `out_amt > 0` (money out) → 只用 `EXP_*` (支出类: HR / MATERIAL / MKT / RENT_UTIL / SHIP / TAX_SURCHARGE / ADMIN / BUILD / EXP_OTHER)

## 退款陷阱

**绝不**因为 summary 含"退"就归为 expense:
- in_amt > 0 + "退款/退押金/退租金/退货款" → `REV_OTHER` (退款)
- out_amt > 0 + "退款" → 真的可能是支出, 需看对手

## 模糊关键词

用 AND 条件消歧:
- "退款" + 对手"京东" → `REV_OTHER`
- "退款" + 对手"美团" → `REV_OTHER`
- "退款" + 对手"房东" → `RENT_UTIL` (退押金是租金)

## 数字一致

- 金额单位都是元, 不要乘 100
- 摘要里的"¥1,234.56" 跟 in_amt 字段对齐, 不要混淆
```

- [ ] **Step 4: 写 skills/financial-rates.md**

```markdown
---
name: financial-rates
description: |
  财务数据口径. 任何涉及毛利率/净利率/财务三表的查询加载.
  解释收付实现制 + 各种 rate 字段的单位约定.
triggers:
  - "毛利率"
  - "净利率"
  - "财务三表"
  - "现金流量"
  - "资产负债表"
---

# Financial Query Conventions

## 会计基础

本平台使用 **收付实现制 (cash-basis)**. `v_profit_statement` 存的是:
- 收入为正数
- 费用为负数

绝大多数 API 把费用 ABS-sum 成正的 `expenses` 字段; `/api/financial/profit` 返回带符号的 line item.

## 比率字段的两种单位约定

| 字段名格式 | 例子 | 单位 | 显示 |
|---|---|---|---|
| camelCase + `Rate` | `grossMarginRate`, `netProfitRate` (来自 `query_financial_overview`) | **小数** | 0.42 → 42% |
| snake_case + `_rate` | `gross_margin_rate`, `net_profit_rate` (在 `query_financial_kpi_trend.monthly[]` 里) | **小数** | 0.42 → 42% |
| snake_case + `_rate_pct` | `gross_profit_rate_pct`, `net_profit_rate_pct` (来自 `query_store_report_*`) | **百分比** | 42.0 → 42% |

**根据字段名和工具描述判断**, 不要假设.

## 毛利率 / 净利率问题

用 `query_financial_overview` 读 `grossMarginRate` / `netProfitRate`, **不要**从原始收入/成本/费用自己算.

## vsPrevPeriod

`query_financial_overview` 的 `vsPrevPeriod` 字段是**环比变化** (小数): 0.05 表示 +5pp. 负数表示下降. 不要跟当前期间的值混淆.

## 净利润口径

净利润**排除** `EXP_OTHER` / `BONUS` (分红/奖金). 其他 `EXP_OTHER` (TAX, REPAY, REFUND) **包含**在内. 用户问"分红/股东分红/bonus payouts" 时排除; 否则按字段自然口径.
```

- [ ] **Step 5: 写 skills/forbidden-shortcuts.md**

```markdown
---
name: forbidden-shortcuts
description: |
  禁用工具和禁用操作. 始终在 system prompt 里 (不进 load_skill).
  防止 Agent 误用没权限的工具或绕过 MCP 直接操作 DB.
---

# Forbidden Shortcuts

## 永久禁用

- **绝不**调 `xintiandi.*` 工具 (schema 未部署, 会 500)
- **绝不**调 `export_rules` (xlsx 包没装, 二进制端点)
- **绝不**调 `create_rule` / `update_rule` / `delete_rule` / `settle` / `approve` / `reject` (Agent 没有 cfg 写权限)
- **绝不**调 `import_rules` / `rollback_rule` / `reorder_rules` (同上)
- **绝不**调 `batch_action_proposals` (同上)

## 禁用询问

- **绝不**问用户 DB 密码
- **绝不**建议直接 DB 访问
- 所有数据走 MCP 工具, 没有捷径
```

- [ ] **Step 6: 写 skills/weekly-bank-review.md**

```markdown
---
name: weekly-bank-review
description: |
  周一早上的银行流水复盘. Cron 周一 9:00 自动跑, 也可用户手动问"上周怎么样".
  拉未分类 KPI + 按文件拆解 + 提 proposal 草稿.
triggers:
  - "周报"
  - "上周"
  - "周复盘"
  - "未分类"
  - "weekly"
---

# 周银行流水复盘

## 适用场景

- Cron 触发 (周一 9:00)
- 用户问"上周怎么样" / "周报" / "未分类还有多少"

## 工作流 (5 步)

### Step 1: 拉 KPI 概览
调 `get_pipeline_kpi(brand=$current_brand)`, 拿上周未分类笔数和总额.

### Step 2: 看是哪些文件拖累
调 `get_unclassified_by_file(limit=10, brand=$current_brand)`, 列出未分类最多的 10 个文件.

### Step 3: 拉 top-3 未分类文件的明细
对 Step 2 的 top-3, 各调一次 `get_unclassified_transactions(file_id, limit=50)`.

### Step 4: 对每笔找现有规则候选
对每笔未分类, 调 `get_candidates(txn_id)`, 看现有规则能否匹配.

### Step 5: 提 proposal + 生成报告
- 对无候选的笔, 用 LLM 判断分类 (参考 `bank-classification` skill), 调 `submit_proposal` 提交
- **单次 submit_proposal 不要超过 20 条** (审批人疲劳)
- 同对手出现 ≥ 3 次才建议提规则

## 输出格式

- Markdown 报告
- 数字带千分位, 金额单位: 元
- 包含: 上周未分类笔数 / 总额 / 主要对手 Top-10 / 建议新增规则数
- 不要重复输出"已分类"的数据, 用户已经看过了
- 中文
```

- [ ] **Step 7: 验证 Skill 文件能 parse (手动)**

```bash
cd agent
# 简单检查: 确认 6 个文件都在, 都能 parse frontmatter
ls -1 agent.md skills/*.md
# 应该 6 行: agent.md + 5 个 .md
```

- [ ] **Step 8: Commit**

```bash
cd agent
git add agent.md skills/
git commit -m "feat(agent/skills): 5 个 Skill 文件 (4 基线 + 1 业务 weekly-bank-review)"
```

---

## Task 8: agent-md-loader (替换 Task 3 的 stub)

**Files:**
- Create: `agent/src/config/agent-md-loader.ts`
- Modify: `agent/src/config/store.ts:70` (替换 loadDefaultAgentMd)

- [ ] **Step 1: 写 agent-md-loader.ts**

```ts
// agent/src/config/agent-md-loader.ts
// 启动时从 agent/agent.md 加载业务指令

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CANDIDATE_PATHS = [
  join(__dirname, '..', '..', 'agent.md'),                   // agent/agent.md
  join(process.cwd(), 'agent.md'),
  join(__dirname, '..', '..', 'default-agent.md'),          // fallback
]

export const AGENT_MD_PATH =
  CANDIDATE_PATHS.find((p) => existsSync(p)) ?? CANDIDATE_PATHS[CANDIDATE_PATHS.length - 1]

export function loadDefaultAgentMd(): string {
  try {
    return readFileSync(AGENT_MD_PATH, 'utf-8')
  } catch {
    return '# 项目级 Agent 指令\n\n（默认 agent.md 加载失败）\n'
  }
}

export { AGENT_MD_PATH as AGENT_MD_FILE_PATH }
```

- [ ] **Step 2: 改 store.ts, 用新 loader**

找到 `agent/src/config/store.ts` 的:
```ts
function loadDefaultAgentMd(): string {
  return '# 项目级 Agent 指令\n\n（默认 agent.md 占位, Task 7 替换）\n'
}
```

替换为:
```ts
import { loadDefaultAgentMd } from './agent-md-loader.ts'
```

- [ ] **Step 3: 跑测试, 确认未退化**

```bash
cd agent
npm test -- src/config/store.test.ts 2>&1 | tail -10
```

Expected: PASS (10 tests)

- [ ] **Step 4: 验证加载 agent/agent.md**

```bash
cd agent
cat > /tmp/smoke.test.ts << 'EOF'
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { loadDefaultAgentMd, AGENT_MD_FILE_PATH } from './src/config/agent-md-loader.ts'

test('loads agent.md from disk', () => {
  const md = loadDefaultAgentMd()
  assert.match(md, /项目级 Agent 指令/)
  console.log('Loaded from:', AGENT_MD_FILE_PATH)
})
EOF
mv /tmp/smoke.test.ts /tmp/_smoke.ts
cat > test/_smoke.test.ts << 'EOF'
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { loadDefaultAgentMd, AGENT_MD_FILE_PATH } from '../src/config/agent-md-loader.ts'

test('loads agent.md from disk', () => {
  const md = loadDefaultAgentMd()
  assert.match(md, /项目级 Agent 指令/)
})
EOF
npm test -- test/_smoke.test.ts 2>&1 | tail -10
rm test/_smoke.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd agent
git add src/config/agent-md-loader.ts src/config/store.ts
git commit -m "feat(agent/config): agent-md-loader 从 agent/agent.md 加载"
```

---

## Task 9: Skill Registry (Y 方案核心)

**Files:**
- Create: `agent/src/skills/types.ts`
- Create: `agent/src/skills/loader.ts`
- Create: `agent/src/skills/registry.ts`
- Create: `agent/src/skills/registry.test.ts`
- Create: `agent/src/skills/load-skill-tool.ts`

- [ ] **Step 1: 写 types.ts**

```ts
// agent/src/skills/types.ts
export interface SkillFrontmatter {
  name: string
  description: string
  triggers?: string[]
  version?: string
}

export interface Skill {
  frontmatter: SkillFrontmatter
  body: string
  fullPath: string
  size: number
  loadedAt: Date
}
```

- [ ] **Step 2: 写 loader.ts**

```ts
// agent/src/skills/loader.ts
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import matter from 'gray-matter'
import type { Skill, SkillFrontmatter } from './types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getSkillsDir(): string {
  // agent/skills/ 跟 src/skills/ 平级
  return process.env.SKILLS_DIR ?? join(__dirname, '..', '..', 'skills')
}

export function loadAllSkills(): Skill[] {
  const dir = getSkillsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  return files.map(f => loadOneSkill(join(dir, f))).filter(Boolean) as Skill[]
}

export function loadOneSkill(path: string): Skill | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as SkillFrontmatter

    if (!fm.name || !fm.description) {
      console.warn(`[skills] ${path}: missing name or description, skip`)
      return null
    }

    return {
      frontmatter: fm,
      body: parsed.content.trim(),
      fullPath: path,
      size: raw.length,
      loadedAt: new Date(),
    }
  } catch (e) {
    console.error(`[skills] ${path}: parse failed`, e)
    return null
  }
}
```

- [ ] **Step 3: 写 registry.ts**

```ts
// agent/src/skills/registry.ts
import type { Skill } from './types.ts'
import { loadAllSkills } from './loader.ts'

const registry = new Map<string, Skill>()

export function initRegistry(): void {
  registry.clear()
  for (const s of loadAllSkills()) {
    if (registry.has(s.frontmatter.name)) {
      throw new Error(`[skills] duplicate name: ${s.frontmatter.name}`)
    }
    registry.set(s.frontmatter.name, s)
  }
  console.log(`[skills] loaded ${registry.size} skills`)
}

export function listSkillDescriptions(): string {
  const skills = [...registry.values()]
  return skills
    .map(s => {
      const triggers = s.frontmatter.triggers?.length
        ? ` (触发词: ${s.frontmatter.triggers.join(', ')})`
        : ''
      return `· ${s.frontmatter.name}${triggers} — ${s.frontmatter.description.replace(/\n/g, ' ')}`
    })
    .join('\n')
}

export function getSkill(name: string): Skill | null {
  return registry.get(name) ?? null
}

export function getSkillFullText(name: string): string | null {
  const s = registry.get(name)
  return s ? formatSkillForLLM(s) : null
}

export function listSkillNames(): string[] {
  return [...registry.keys()]
}

function formatSkillForLLM(s: Skill): string {
  return `# Skill: ${s.frontmatter.name}\n\n${s.body}`
}
```

- [ ] **Step 4: 写 registry.test.ts**

```ts
// agent/src/skills/registry.test.ts
import { test, before } from 'node:test'
import { strict as assert } from 'node:assert'
import { initRegistry, listSkillDescriptions, getSkill, getSkillFullText, listSkillNames } from './registry.ts'

before(() => {
  initRegistry()
})

test('registry loaded expected skills', () => {
  const names = listSkillNames()
  assert.ok(names.length >= 5, `expected at least 5 skills, got ${names.length}`)
  assert.ok(names.includes('weekly-bank-review'))
  assert.ok(names.includes('wdg-data-platform'))
  assert.ok(names.includes('bank-classification'))
  assert.ok(names.includes('financial-rates'))
  assert.ok(names.includes('forbidden-shortcuts'))
})

test('listSkillDescriptions mentions all skills', () => {
  const desc = listSkillDescriptions()
  for (const name of ['weekly-bank-review', 'wdg-data-platform']) {
    assert.match(desc, new RegExp(name))
  }
})

test('getSkill returns skill for valid name', () => {
  const s = getSkill('weekly-bank-review')
  assert.ok(s)
  assert.equal(s!.frontmatter.name, 'weekly-bank-review')
  assert.match(s!.body, /get_pipeline_kpi/)
})

test('getSkill returns null for missing', () => {
  assert.equal(getSkill('non-existent'), null)
})

test('getSkillFullText formats correctly', () => {
  const text = getSkillFullText('weekly-bank-review')
  assert.ok(text)
  assert.match(text!, /^# Skill: weekly-bank-review/)
})
```

- [ ] **Step 5: 跑测试**

```bash
cd agent
npm test -- src/skills/registry.test.ts 2>&1 | tail -15
```

Expected: PASS (5 tests)

- [ ] **Step 6: 写 load-skill-tool.ts**

```ts
// agent/src/skills/load-skill-tool.ts
// load_skill 作为 LLM 工具 — AgentRunner 特殊处理 (不走 MCP)

import type Anthropic from '@anthropic-ai/sdk'
import { getSkillFullText, listSkillNames } from './registry.ts'

export const LOAD_SKILL_NAME = 'load_skill'

export const loadSkillTool: Anthropic.Tool = {
  name: LOAD_SKILL_NAME,
  description: `加载指定 skill 的完整内容到当前对话上下文.
可用 skill 列表见 system prompt 的 "Available Skills" 段.
调用时机: 当用户问题匹配某个 skill 的描述/触发词时, 先调本工具加载, 再按 skill 的工作流执行.`,
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'skill 的 name 字段 (e.g. "weekly-bank-review")' },
      reason: { type: 'string', description: '为什么加载这个 skill (用于审计)' },
    },
    required: ['name', 'reason'],
  },
}

export interface LoadSkillResult {
  skillName: string
  content: string
  bytesLoaded: number
}

export function handleLoadSkill(args: { name: string; reason: string }): LoadSkillResult {
  const content = getSkillFullText(args.name)
  if (!content) {
    return {
      skillName: args.name,
      content: `ERROR: skill "${args.name}" not found. Available skills: ${listSkillNames().join(', ')}`,
      bytesLoaded: 0,
    }
  }
  return {
    skillName: args.name,
    content,
    bytesLoaded: content.length,
  }
}
```

- [ ] **Step 7: Type check + Commit**

```bash
cd agent
npx tsc --noEmit
git add src/skills/
git commit -m "feat(agent/skills): Y 方案 Registry + load_skill 工具"
```

---

## Task 10: McpBridge (v0 复制)

**Files:**
- Create: `agent/src/mcp/bridge.ts`
- Create: `agent/src/mcp/bridge.test.ts`
- Create: `agent/test/helpers/mock-mcp.ts` (Task 17 之后用, 先建)

- [ ] **Step 1: 写 bridge.ts**

```ts
// agent/src/mcp/bridge.ts
// 调既有 /api/mcp 的 JSON-RPC 客户端

import { McpError, mapMcpError } from '../errors.ts'
import type { AgentConfig } from '../config/store.ts'

export interface McpCallResult {
  success: boolean
  data: any
  error?: string
  retryable: boolean
}

export class McpBridge {
  constructor(
    private endpoint: string,
    private config: AgentConfig,
    private retryMax: number = config.params.mcpRetryMaxAttempts,
  ) {}

  async call(toolName: string, args: any, userId: string): Promise<McpCallResult> {
    let lastErr: any
    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-mcp-session': 'internal',
            'x-wdg-user-id': userId,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'tools/call',
            params: { name: toolName, arguments: args },
          }),
        })
        const json = await res.json() as any
        if (json.error) {
          const code = mapMcpError(json.error.code ?? 0)
          return {
            success: false,
            data: null,
            error: json.error.message,
            retryable: this.isRetryable(code),
          }
        }
        return { success: true, data: json.result, retryable: false }
      } catch (e: any) {
        lastErr = e
        if (attempt < this.retryMax) {
          await sleep(1000 * (attempt + 1))
        }
      }
    }
    return {
      success: false,
      data: null,
      error: lastErr?.message ?? 'MCP call failed',
      retryable: true,
    }
  }

  async listTools(): Promise<any[]> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mcp-session': 'internal' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} }),
      })
      const json = await res.json() as any
      return (json.result?.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))
    } catch (e) {
      console.error('[McpBridge] listTools failed:', e)
      return []
    }
  }

  private isRetryable(code: string): boolean {
    return code === 'MCP_DB_ERROR' || code === 'MCP_NETWORK'
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
```

- [ ] **Step 2: 写 mock-mcp.ts (测试 helper)**

```ts
// agent/test/helpers/mock-mcp.ts
import { McpBridge, type McpCallResult } from '../../src/mcp/bridge.ts'

export class MockMcpBridge extends McpBridge {
  private handlers: Record<string, (args: any, userId: string) => McpCallResult> = {}

  constructor() {
    super('http://mock', { agentMd: '', params: { mcpRetryMaxAttempts: 0 } as any, baseURL: null, apiKey: null, model: 'mock' })
  }

  call = async (toolName: string, args: any, userId: string): Promise<McpCallResult> => {
    const handler = this.handlers[toolName]
    if (!handler) {
      return { success: false, data: null, error: `Tool not found: ${toolName}`, retryable: false }
    }
    return handler(args, userId)
  }

  listTools = async () => Object.keys(this.handlers).map(name => ({
    name,
    description: `Mock ${name}`,
    input_schema: { type: 'object', properties: {} },
  }))

  on(toolName: string, handler: (args: any, userId: string) => McpCallResult) {
    this.handlers[toolName] = handler
  }

  reset() { this.handlers = {} }
}
```

- [ ] **Step 3: 写 bridge.test.ts (集成, 用 mock fetch)**

```ts
// agent/src/mcp/bridge.test.ts
import { test } from 'node:test'
import { strict as assert } from 'node:assert'

// mock fetch
const originalFetch = globalThis.fetch
let mockResponses: any[] = []
;(globalThis as any).fetch = async (url: string, opts: any) => {
  const body = JSON.parse(opts.body)
  const next = mockResponses.shift()
  return {
    json: async () => next,
    status: next?.error ? 500 : 200,
  } as any
}

test.after(() => { globalThis.fetch = originalFetch })

import('../mcp/bridge.ts').then(async ({ McpBridge }) => {

  test('call returns data on success', async () => {
    mockResponses = [{ result: { foo: 'bar' } }]
    const bridge = new McpBridge('http://test', {} as any, 0)
    const r = await bridge.call('test_tool', { x: 1 }, 'user-1')
    assert.equal(r.success, true)
    assert.deepEqual(r.data, { foo: 'bar' })
  })

  test('call returns error on tool not found', async () => {
    mockResponses = [{ error: { code: -32601, message: 'method not found' } }]
    const bridge = new McpBridge('http://test', {} as any, 0)
    const r = await bridge.call('missing_tool', {}, 'user-1')
    assert.equal(r.success, false)
    assert.equal(r.retryable, false)
    assert.match(r.error!, /method not found/)
  })
})
```

- [ ] **Step 4: 跑测试**

```bash
cd agent
npm test -- src/mcp/bridge.test.ts 2>&1 | tail -10
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd agent
git add src/mcp/ test/helpers/mock-mcp.ts
git commit -m "feat(agent/mcp): McpBridge 调 /api/mcp, 复用既有 45 tools"
```

---

## Task 11: ChatDrawer 改 endpoint (前端)

**Files:**
- Modify: `ui/src/components/chat/ChatDrawer.tsx`
- Modify: `ui/src/app/api/chat/route.ts` (标记 deprecated, 保留 v0)

- [ ] **Step 1: 看现有 ChatDrawer.tsx 的连接逻辑**

```bash
cd ui
grep -n "EventSource\|/api/chat\|fetch.*chat" src/components/chat/ChatDrawer.tsx
```

- [ ] **Step 2: 加 feature flag 工具**

```ts
// ui/src/lib/feature-flags.ts (新建)
export function shouldUseAgentService(userId: string | null | undefined): boolean {
  const flag = process.env.NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT ?? '0'
  const pct = parseInt(flag, 10)
  if (pct === 0 || !userId) return false
  if (pct >= 100) return true
  const hash = [...userId].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return (hash % 100) < pct
}

export function getAgentWsUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_WS_URL ?? 'ws://localhost:4101/ws'
}
```

- [ ] **Step 3: 改 ChatDrawer.tsx, 加 fallback 逻辑**

找到原 ChatDrawer 中创建连接的地方 (e.g. `new EventSource('/api/chat')` 或 `fetch('/api/chat', ...)`), 替换为:

```tsx
// 假设 ChatDrawer 有 user 信息 (从 useSession 或 props)
import { shouldUseAgentService, getAgentWsUrl } from '@/lib/feature-flags'

function connectChat() {
  const userId = session?.user?.id
  if (shouldUseAgentService(userId)) {
    // 走 v1 Agent Service
    const url = `${getAgentWsUrl()}?userId=${userId}&conversationId=${convId ?? ''}`
    return new WebSocket(url)
  } else {
    // 走 v0 fallback
    return new EventSource('/api/chat')
  }
}
```

(具体代码取决于 v0 现有 ChatDrawer 的实现, 关键是: **保留 v0 路径, 默认走 v0, 通过 env var 控制切流**)

- [ ] **Step 4: 加 env 到 .env.example**

```bash
# ui/.env.example (追加)
NEXT_PUBLIC_AGENT_WS_URL=ws://agent:4101/ws
NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=0
```

- [ ] **Step 5: 验证 build 还能过**

```bash
cd ui
npx next build 2>&1 | tail -10
```

Expected: Build successful

- [ ] **Step 6: 跑 v0 chat (v0 仍然能用)**

```bash
cd ui
# 验证 v0 chat 路由还在
curl -s http://localhost:4100/api/chat -X POST -H "Content-Type: application/json" -d '{}' | head -5
```

Expected: v0 chat 正常响应 (或返回某种 SSE 错误, 但路由存在)

- [ ] **Step 7: Commit**

```bash
cd ui
git add src/lib/feature-flags.ts src/components/chat/ChatDrawer.tsx .env.example
git commit -m "feat(ui): ChatDrawer 加 feature flag, 切流到 Agent Service (默认 0%)"
```

---

# W3 — 5 个 Skill 补全 + Runner

## Task 12: ConversationManager (短期记忆)

**Files:**
- Create: `agent/src/conversation/manager.ts`
- Create: `agent/src/conversation/manager.test.ts`

- [ ] **Step 1: 写 manager.ts**

```ts
// agent/src/conversation/manager.ts
import type { Pool } from 'pg'
import type Anthropic from '@anthropic-ai/sdk'
import type { IncomingMsg } from '../channels/types.ts'

export interface ConversationMessage {
  messageId: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls: any | null
  toolResults: any | null
  thinking: string | null
  createdAt: Date
}

export class ConversationManager {
  constructor(
    private db: Pool,
    private anthropic: Anthropic,
    private windowSize: number = 10,
  ) {}

  async getOrCreate(msg: IncomingMsg): Promise<{ conversationId: string }> {
    if (msg.conversationId) {
      await this.db.query(
        `UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`,
        [msg.conversationId],
      )
      return { conversationId: msg.conversationId }
    }
    const { rows } = await this.db.query(`
      INSERT INTO agent.conversations (user_id, brand, channel_id)
      VALUES ($1, $2, $3)
      RETURNING conversation_id
    `, [msg.userId, msg.brand, msg.channelId])
    return { conversationId: rows[0].conversation_id }
  }

  async getMessages(conversationId: string, limit: number): Promise<ConversationMessage[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id DESC
      LIMIT $2
    `, [conversationId, limit])
    return rows.reverse().map((r: any) => ({
      messageId: r.message_id,
      role: r.role,
      content: r.content,
      toolCalls: r.tool_calls,
      toolResults: r.tool_results,
      thinking: r.thinking,
      createdAt: r.created_at,
    }))
  }

  async getSummary(conversationId: string): Promise<string> {
    const { rows } = await this.db.query(
      `SELECT summary FROM agent.conversations WHERE conversation_id = $1`,
      [conversationId],
    )
    return rows[0]?.summary ?? ''
  }

  async appendMessage(msg: {
    conversationId: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    toolCalls?: any
    toolResults?: any
    thinking?: string
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO agent.messages (conversation_id, role, content, tool_calls, tool_results, thinking)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      msg.conversationId, msg.role, msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolResults ? JSON.stringify(msg.toolResults) : null,
      msg.thinking ?? null,
    ])
    await this.db.query(
      `UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`,
      [msg.conversationId],
    )
  }

  async maybeCompress(conversationId: string): Promise<void> {
    const count = await this.countMessages(conversationId)
    if (count <= this.windowSize * 2) return
    const oldMsgs = await this.getOldestMessages(conversationId, this.windowSize)
    const oldText = oldMsgs.map((m: ConversationMessage) => `${m.role}: ${m.content}`).join('\n')
    const summary = await this.summarize(oldText)
    await this.db.query(`
      DELETE FROM agent.messages WHERE message_id IN (
        SELECT message_id FROM agent.messages
        WHERE conversation_id = $1
        ORDER BY message_id ASC LIMIT $2
      )
    `, [conversationId, this.windowSize])
    await this.db.query(`
      UPDATE agent.conversations
      SET summary = COALESCE(summary, '') || $2 || E'\n---\n'
      WHERE conversation_id = $1
    `, [conversationId, summary])
  }

  private async countMessages(conversationId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM agent.messages WHERE conversation_id = $1`,
      [conversationId],
    )
    return rows[0].n
  }

  private async getOldestMessages(conversationId: string, n: number): Promise<ConversationMessage[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id ASC LIMIT $2
    `, [conversationId, n])
    return rows.map((r: any) => ({
      messageId: r.message_id, role: r.role, content: r.content,
      toolCalls: r.tool_calls, toolResults: r.tool_results, thinking: r.thinking, createdAt: r.created_at,
    }))
  }

  private async summarize(text: string): Promise<string> {
    if (text.length < 100) return text
    try {
      const res = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `请用 200 字以内总结以下对话的关键事实 (业务数据、用户偏好、判断结论):\n\n${text}`,
        }],
      })
      return res.content[0].type === 'text' ? res.content[0].text : ''
    } catch {
      return '(summary failed)'
    }
  }
}
```

- [ ] **Step 2: 写 manager.test.ts (集成测试, pg-mem)**

```ts
// agent/src/conversation/manager.test.ts
import { test, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import { ConversationManager } from './manager.ts'
import { createTestDb, cleanupTestDb } from '../../test/helpers/mock-db.ts'
import Anthropic from '@anthropic-ai/sdk'

let pool: any
let mgr: ConversationManager

before(async () => {
  pool = await createTestDb()
  // 不需要真 anthropic, 测时不调 summarize
  mgr = new ConversationManager(pool, {} as any, 10)
})

test('getOrCreate creates new conversation', async () => {
  const { conversationId } = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: 'yufeng', conversationId: null, content: 'hi',
  })
  assert.match(conversationId, /^[0-9a-f-]+$/)
})

test('appendMessage + getMessages returns in order', async () => {
  await cleanupTestDb(pool)
  const { conversationId } = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'first',
  })
  await mgr.appendMessage({ conversationId, role: 'user', content: 'first' })
  await mgr.appendMessage({ conversationId, role: 'assistant', content: 'reply' })
  const msgs = await mgr.getMessages(conversationId, 10)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].content, 'first')
  assert.equal(msgs[1].content, 'reply')
})

test('getOrCreate with existing id returns same', async () => {
  await cleanupTestDb(pool)
  const first = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'x',
  })
  const second = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: null, conversationId: first.conversationId, content: 'y',
  })
  assert.equal(first.conversationId, second.conversationId)
})
```

- [ ] **Step 3: 跑测试**

```bash
cd agent
npm test -- src/conversation/manager.test.ts 2>&1 | tail -10
```

Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
cd agent
git add src/conversation/
git commit -m "feat(agent/conversation): ConversationManager — 短期记忆 + LLM 压缩"
```

---

## Task 13: Notifier (WS 推送抽象)

**Files:**
- Create: `agent/src/notifications/notifier.ts`
- Create: `agent/src/notifications/web-push.ts`

- [ ] **Step 1: 写 notifier.ts (抽象接口)**

```ts
// agent/src/notifications/notifier.ts
export type NotificationType =
  | 'task_update' | 'task_done' | 'task_failed'
  | 'cron_fired' | 'system_error'

export interface Notification {
  type: NotificationType
  conversationId: string | null  // null = 不推 UI, 只记 audit
  payload: any
}

export interface Notifier {
  push(notification: Notification): Promise<void>
}

export class NullNotifier implements Notifier {
  async push(_: Notification) { /* no-op */ }
}
```

- [ ] **Step 2: 写 web-push.ts (Web 实现)**

```ts
// agent/src/notifications/web-push.ts
import type { Notifier, Notification } from './notifier.ts'
import type { WebChannel } from '../channels/web.ts'

export class WebNotifier implements Notifier {
  constructor(private webChannel: WebChannel) {}

  async push(n: Notification) {
    if (!n.conversationId) return  // 没有目标会话, 不推
    await this.webChannel.send({
      channelId: 'web',
      conversationId: n.conversationId,
      type: n.type === 'task_update' ? 'task_update' : 'system_error',
      payload: n.payload,
    })
  }
}
```

- [ ] **Step 3: Type check + Commit**

```bash
cd agent
npx tsc --noEmit
git add src/notifications/
git commit -m "feat(agent/notifications): Notifier 抽象 + Web 实现"
```

---

## Task 14: AgentRunner (LLM 循环 + load_skill 分发)

**Files:**
- Create: `agent/src/agent/prompt.ts`
- Create: `agent/src/agent/runner.ts`
- Create: `agent/src/agent/runner.test.ts`
- Create: `agent/test/helpers/mock-anthropic.ts`

- [ ] **Step 1: 写 mock-anthropic.ts**

```ts
// agent/test/helpers/mock-anthropic.ts
import Anthropic from '@anthropic-ai/sdk'

export interface MockResponse {
  text?: string
  toolCalls?: { name: string; input: any }[]
  thinking?: string
  error?: { code: number; message: string }
  usage?: { input_tokens: number; output_tokens: number }
}

export class MockAnthropic {
  responses: MockResponse[] = []
  callIndex = 0

  messages = {
    create: async (params: any): Promise<any> => {
      const next = this.responses[this.callIndex++]
      if (!next) throw new Error('No more mock responses')
      if (next.error) {
        const err: any = new Error(next.error.message)
        err.status = next.error.code
        throw err
      }
      return {
        content: [
          ...(next.thinking ? [{ type: 'thinking', thinking: next.thinking }] : []),
          ...(next.text ? [{ type: 'text', text: next.text }] : []),
          ...(next.toolCalls?.map((tc, i) => ({
            type: 'tool_use', id: `tool_${i}`, name: tc.name, input: tc.input,
          })) ?? []),
        ],
        stop_reason: next.toolCalls ? 'tool_use' : 'end_turn',
        usage: next.usage ?? { input_tokens: 100, output_tokens: 50 },
      }
    },
    stream: (params: any): any => {
      const next = this.responses[this.callIndex++]
      if (!next) throw new Error('No more mock responses')
      if (next.error) {
        const err: any = new Error(next.error.message)
        err.status = next.error.code
        throw err
      }
      const events: any[] = []
      if (next.text) {
        events.push({ type: 'content_block_start', content_block: { type: 'text', text: '' } })
        events.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: next.text } })
        events.push({ type: 'content_block_stop' })
      }
      if (next.toolCalls) {
        for (const tc of next.toolCalls) {
          events.push({ type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: tc.name, input: tc.input } })
        }
        events.push({ type: 'content_block_stop' })
      }
      events.push({ type: 'message_delta', usage: { output_tokens: 50 } })
      events.push({ type: 'message_stop' })
      return {
        [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
        finalMessage: async () => ({
          content: [
            ...(next.text ? [{ type: 'text', text: next.text }] : []),
            ...(next.toolCalls?.map((tc, i) => ({ type: 'tool_use', id: `t${i}`, name: tc.name, input: tc.input })) ?? []),
          ],
          stop_reason: next.toolCalls ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      }
    },
  }
  // 兼容 Anthropic SDK 实例
  static isInstance(_: any): _ is Anthropic { return false }
}

export function makeAnthropicFromMock(mock: MockAnthropic): Anthropic {
  return mock as any as Anthropic
}
```

- [ ] **Step 2: 写 prompt.ts**

```ts
// agent/src/agent/prompt.ts
import { listSkillDescriptions, getSkillFullText } from '../skills/registry.ts'
import type Anthropic from '@anthropic-ai/sdk'
import { loadSkillTool } from '../skills/load-skill-tool.ts'

export interface PageCtx {
  brand?: string | null
  channel?: string
  conversationId?: string | null
}

export function buildSystemPrompt(
  ctx: PageCtx,
  agentMd: string,
  tools: Anthropic.Tool[],
): string {
  const today = new Date().toISOString().slice(0, 10)
  const skillIndex = listSkillDescriptions()
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
  const forbidden = getSkillFullText('forbidden-shortcuts') ?? ''

  return `${agentMd}

# Today
${today}

# Current Context
brand=${ctx.brand ?? '<none>'}, channel=${ctx.channel ?? 'web'}

# Available Skills
调用 load_skill(name) 加载完整工作流:
${skillIndex}

# Tools (${tools.length})
${toolList}

# General Rules
- Use tools. Don't make up numbers.
- 中文回答
- 调 load_skill 后, 按 skill 的工作流执行

${forbidden}`
}
```

- [ ] **Step 3: 写 runner.ts (核心 LLM 循环)**

```ts
// agent/src/agent/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, thinkingConfigFor } from '../config/store.ts'
import { McpBridge } from '../mcp/bridge.ts'
import { ConversationManager } from '../conversation/manager.ts'
import { Notifier } from '../notifications/notifier.ts'
import { listSkillDescriptions, getSkillFullText, initRegistry as _ } from '../skills/registry.ts'  // import 触发 init
import { handleLoadSkill, LOAD_SKILL_NAME } from '../skills/load-skill-tool.ts'
import { buildSystemPrompt } from './prompt.ts'
import type { IncomingMsg } from '../channels/types.ts'
import { LlmError, mapAnthropicError } from '../errors.ts'

export interface AgentRunnerDeps {
  anthropic: Anthropic
  mcpBridge: McpBridge
  conversation: ConversationManager
  notifier: Notifier
}

export class AgentRunner {
  constructor(private deps: AgentRunnerDeps) {}

  async handle(msg: IncomingMsg): Promise<{ conversationId: string; text: string }> {
    const cfg = getAgentConfig()
    const conv = await this.deps.conversation.getOrCreate(msg)
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)
    const tools = await this.deps.mcpBridge.listTools()
    // 注入 load_skill 工具 (不进 MCP, 是 agent 内部 tool)
    tools.push({
      name: LOAD_SKILL_NAME,
      description: '加载 skill 完整内容',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
    } as any)

    const system = buildSystemPrompt(
      { brand: msg.brand, channel: msg.channelId, conversationId: conv.conversationId },
      cfg.agentMd,
      tools,
    )

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({ role: m.role as any, content: m.content })),
      { role: 'user', content: msg.content },
    ]

    const finalText = await this.runLlmLoop(system, messages, msg, conv.conversationId, tools)

    await this.deps.conversation.appendMessage({
      conversationId: conv.conversationId, role: 'assistant', content: finalText,
    })

    return { conversationId: conv.conversationId, text: finalText }
  }

  private async runLlmLoop(
    system: string,
    messages: Anthropic.MessageParam[],
    msg: IncomingMsg,
    conversationId: string,
    tools: Anthropic.Tool[],
  ): Promise<string> {
    const cfg = getAgentConfig()
    let iter = 0
    let finalText = ''

    while (iter < cfg.params.maxToolChainDepth) {
      iter++

      let response: Anthropic.Message
      try {
        response = await this.deps.anthropic.messages.create({
          model: cfg.model,
          max_tokens: cfg.params.maxTokens,
          temperature: cfg.params.temperature,
          system,
          tools: tools as any,
          messages,
          ...(thinkingConfigFor(cfg.params.thinkingLevel) ? { thinking: thinkingConfigFor(cfg.params.thinkingLevel)! } : {}),
        })
      } catch (e) {
        const code = mapAnthropicError(e)
        throw new LlmError(code, (e as Error).message, code !== 'LLM_AUTH', e as Error)
      }

      let turnText = ''
      const toolUses: Anthropic.ToolUseBlock[] = []
      for (const block of response.content) {
        if (block.type === 'text') turnText += block.text
        else if (block.type === 'tool_use') toolUses.push(block as any)
      }
      finalText = turnText

      await this.deps.conversation.appendMessage({
        conversationId, role: 'assistant', content: turnText,
        toolCalls: toolUses.length ? toolUses : undefined,
      })

      if (toolUses.length === 0) break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        let content: any
        let isError = false
        if (tu.name === LOAD_SKILL_NAME) {
          const r = handleLoadSkill(tu.input as any)
          content = r.content
          isError = r.bytesLoaded === 0
          await this.deps.notifier.push({
            type: 'task_update', conversationId,
            payload: { kind: 'skill_loaded', name: r.skillName, bytes: r.bytesLoaded },
          })
        } else {
          const r = await this.deps.mcpBridge.call(tu.name, tu.input, msg.userId)
          content = r.success ? r.data : `ERROR: ${r.error}`
          isError = !r.success
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof content === 'string' ? content : JSON.stringify(content), is_error: isError })
      }

      messages.push({ role: 'assistant', content: toolUses as any })
      messages.push({ role: 'user', content: toolResults })
    }

    return finalText
  }
}
```

- [ ] **Step 4: 写 runner.test.ts**

```ts
// agent/src/agent/runner.test.ts
import { test, before } from 'node:test'
import { strict as assert } from 'node:assert'
import { AgentRunner } from './runner.ts'
import { MockMcpBridge } from '../../test/helpers/mock-mcp.ts'
import { MockAnthropic } from '../../test/helpers/mock-anthropic.ts'
import { createTestDb, cleanupTestDb } from '../../test/helpers/mock-db.ts'
import { ConversationManager } from '../conversation/manager.ts'
import { initRegistry } from '../skills/registry.ts'
import { resetAgentConfig, setCredentialConfig } from '../config/store.ts'

let pool: any
let mgr: ConversationManager
let mcp: MockMcpBridge
let llm: MockAnthropic
let runner: AgentRunner
let notifications: any[]

before(async () => {
  initRegistry()
  pool = await createTestDb()
  await cleanupTestDb(pool)
  mgr = new ConversationManager(pool, {} as any, 10)
  mcp = new MockMcpBridge()
  llm = new MockAnthropic()
  resetAgentConfig()
  setCredentialConfig(null, 'sk-test', 'claude-mock')
  notifications = []
  runner = new AgentRunner({
    anthropic: llm as any,
    mcpBridge: mcp as any,
    conversation: mgr,
    notifier: { push: async (n) => { notifications.push(n) } },
  })
})

test('单轮对话, LLM 直接返回文本', async () => {
  await cleanupTestDb(pool)
  llm.responses = [{ text: '你好!' }]
  llm.callIndex = 0

  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'hi',
  })

  assert.equal(result.text, '你好!')
})

test('LLM 调 MCP 工具后回答', async () => {
  await cleanupTestDb(pool)
  llm.responses = [
    { toolCalls: [{ name: 'get_brand_stores', input: {} }] },
    { text: '有 3 个品牌' },
  ]
  llm.callIndex = 0
  mcp.reset()
  mcp.on('get_brand_stores', () => ({ success: true, data: { brands: ['yufeng', 'bonjur', 'tamkoko'] } }))

  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: '有哪些品牌',
  })

  assert.equal(result.text, '有 3 个品牌')
})

test('load_skill 走 SkillRegistry, 不调 MCP', async () => {
  await cleanupTestDb(pool)
  llm.responses = [
    { toolCalls: [{ name: 'load_skill', input: { name: 'weekly-bank-review', reason: 'test' } }] },
    { text: 'skill 加载完成' },
  ]
  llm.callIndex = 0
  mcp.reset()
  let mcpCalled = false
  mcp.on('any', () => { mcpCalled = true; return { success: true, data: null } })

  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: '加载 skill',
  })

  assert.equal(result.text, 'skill 加载完成')
  assert.equal(mcpCalled, false)  // load_skill 不走 MCP
})
```

- [ ] **Step 5: 跑测试**

```bash
cd agent
npm test -- src/agent/runner.test.ts 2>&1 | tail -15
```

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd agent
git add src/agent/ test/helpers/mock-anthropic.ts
git commit -m "feat(agent/runner): AgentRunner LLM 循环 + load_skill 分发"
```

---

## Task 15: ChannelManager 接 AgentRunner (替换 Task 6 的 stub)

**Files:**
- Modify: `agent/src/channels/manager.ts`
- Modify: `agent/src/server.ts`

- [ ] **Step 1: 重写 channels/manager.ts**

```ts
// agent/src/channels/manager.ts
import type { IncomingMsg } from './types.ts'
import { AgentRunner } from '../agent/runner.ts'
import { TaskScheduler } from '../tasks/scheduler.ts'
import { WebChannel } from './web.ts'

export class ChannelManager {
  constructor(
    private webChannel: WebChannel,
    private runner: AgentRunner,
    private scheduler?: TaskScheduler,
  ) {}

  async onIncoming(msg: IncomingMsg): Promise<void> {
    // 1. Cron 触发的, 走任务队列
    if (msg.channelId === 'cron' && msg.metadata?.taskType && this.scheduler) {
      await this.scheduler.enqueue({
        taskType: msg.metadata.taskType,
        input: msg.metadata,
        triggeredBy: msg.userId,
      })
      return
    }

    // 2. 即时对话, 走 AgentRunner
    const result = await this.runner.handle(msg)

    // 3. 回推给原 channel
    await this.webChannel.send({
      channelId: msg.channelId,
      conversationId: result.conversationId,
      type: 'text_block',
      payload: { text: result.text },
    })
  }
}
```

- [ ] **Step 2: 改 server.ts, 注入依赖**

```ts
// agent/src/server.ts (替换)
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import { registerHealth } from './health.ts'
import { WebChannel } from './channels/web.ts'
import { ChannelManager } from './channels/manager.ts'
import { AgentRunner } from './agent/runner.ts'
import { McpBridge } from './mcp/bridge.ts'
import { ConversationManager } from './conversation/manager.ts'
import { NullNotifier } from './notifications/notifier.ts'
import { getAgentConfig } from './config/store.ts'
import { getPool } from './db.ts'
import { initRegistry } from './skills/registry.ts'
import Anthropic from '@anthropic-ai/sdk'

const PORT = parseInt(process.env.WS_PORT ?? '4101', 10)

async function main() {
  // 启动探活
  await getPool().query('SELECT 1')
  initRegistry()
  const cfg = getAgentConfig()
  const anthropic = new Anthropic({
    apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: cfg.baseURL ?? undefined,
  })

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
  await app.register(cors, { origin: true, credentials: true })
  await app.register(websocket)
  await registerHealth(app)

  // Wire up
  const mcpBridge = new McpBridge(process.env.MCP_ENDPOINT ?? 'http://localhost:4100/api/mcp', cfg)
  const conversation = new ConversationManager(getPool(), anthropic)
  const notifier = new NullNotifier()
  const runner = new AgentRunner({ anthropic, mcpBridge, conversation, notifier })

  const webChannel = new WebChannel(PORT, null)
  const manager = new ChannelManager(webChannel, runner)
  ;(webChannel as any).manager = manager  // inject back

  await webChannel.start()
  app.log.info(`Agent Service listening on ${PORT}`)

  const shutdown = async () => {
    app.log.info('shutting down...')
    await webChannel.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Type check + 跑起来 + curl 测试**

```bash
cd agent
npx tsc --noEmit
WS_PORT=4101 timeout 5 npx tsx src/server.ts 2>&1 | tail -10
```

Expected: `Agent Service listening on 4101`

- [ ] **Step 4: Commit**

```bash
cd agent
git add src/channels/manager.ts src/server.ts
git commit -m "feat(agent): ChannelManager 接 AgentRunner, 完整链路"
```

---

# W4 — TaskScheduler + Cron + Notifier

## Task 16: TaskScheduler (DB-backed queue + 状态机)

**Files:**
- Create: `agent/src/tasks/types.ts`
- Create: `agent/src/tasks/registry.ts`
- Create: `agent/src/tasks/scheduler.ts`
- Create: `agent/src/tasks/scheduler.test.ts`
- Create: `agent/src/tasks/handlers/weekly-bank-review.ts`

- [ ] **Step 1: 写 types.ts**

```ts
// agent/src/tasks/types.ts
export type TaskStatus = 'NEW' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'PARTIAL'
export type StepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'

export interface TaskDefinition {
  taskType: string
  input: any
  triggeredBy: string
  parentTaskId?: string
  conversationId?: string
}

export interface TaskRow {
  task_id: string
  parent_task_id: string | null
  conversation_id: string | null
  user_id: string | null
  task_type: string
  input: any
  status: TaskStatus
  progress: number
  result: any | null
  error: any | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

export interface TaskStepUpdate {
  stepIndex: number
  description: string
  status: StepStatus
  result?: any
  error?: string
}

export type TaskHandler = (task: TaskRow) => AsyncGenerator<TaskStepUpdate>
```

- [ ] **Step 2: 写 registry.ts**

```ts
// agent/src/tasks/registry.ts
import type { TaskHandler } from './types.ts'

const handlers = new Map<string, TaskHandler>()

export function registerTaskHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler)
}

export function getHandler(type: string): TaskHandler | null {
  return handlers.get(type) ?? null
}

export function listRegisteredTypes(): string[] {
  return [...handlers.keys()]
}
```

- [ ] **Step 3: 写 scheduler.ts**

```ts
// agent/src/tasks/scheduler.ts
import type { Pool } from 'pg'
import type { TaskDefinition, TaskRow, TaskStepUpdate } from './types.ts'
import { getHandler } from './registry.ts'
import type { Notifier } from '../notifications/notifier.ts'
import type { McpBridge } from '../mcp/bridge.ts'

const POLL_INTERVAL_MS = 1000

export class TaskScheduler {
  constructor(
    private db: Pool,
    private notifier: Notifier,
    private mcpBridge: McpBridge,
    private workerCount: number = 4,
  ) {}

  start(): void {
    for (let i = 0; i < this.workerCount; i++) {
      this.workerLoop(i)
    }
  }

  async enqueue(def: TaskDefinition): Promise<string> {
    const { rows } = await this.db.query(`
      INSERT INTO agent.tasks
        (status, task_type, input, user_id, parent_task_id, conversation_id)
      VALUES ('QUEUED', $1, $2, $3, $4, $5)
      RETURNING task_id
    `, [def.taskType, JSON.stringify(def.input), def.triggeredBy, def.parentTaskId ?? null, def.conversationId ?? null])
    return rows[0].task_id
  }

  private async workerLoop(workerId: number): Promise<void> {
    while (true) {
      const task = await this.pickTask()
      if (!task) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      await this.runTask(task)
    }
  }

  private async pickTask(): Promise<TaskRow | null> {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(`
        UPDATE agent.tasks
        SET status = 'RUNNING', started_at = NOW()
        WHERE task_id = (
          SELECT task_id FROM agent.tasks
          WHERE status = 'QUEUED'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
      `)
      await client.query('COMMIT')
      return rows[0] ?? null
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  private async runTask(task: TaskRow): Promise<void> {
    const handler = getHandler(task.task_type)
    if (!handler) {
      await this.failTask(task.task_id, `No handler for ${task.task_type}`)
      return
    }

    let lastStepIndex = 0
    let anyFailed = false
    try {
      for await (const update of handler(task)) {
        lastStepIndex = update.stepIndex
        await this.recordStep(task.task_id, update)
        await this.notifier.push({
          type: 'task_update', conversationId: task.conversation_id,
          payload: { taskId: task.task_id, step: update.stepIndex, status: update.status, description: update.description },
        })
        if (update.status === 'FAILED') anyFailed = true
      }
      await this.completeTask(task.task_id, lastStepIndex, anyFailed)
    } catch (e: any) {
      await this.failTask(task.task_id, e.message ?? String(e))
    }
  }

  private async recordStep(taskId: string, update: TaskStepUpdate): Promise<void> {
    await this.db.query(`
      INSERT INTO agent.task_steps (task_id, step_index, description, status, started_at, finished_at, result, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (task_id, step_index) DO UPDATE SET
        status = EXCLUDED.status, finished_at = EXCLUDED.finished_at,
        result = EXCLUDED.result, error = EXCLUDED.error
    `, [
      taskId, update.stepIndex, update.description, update.status,
      update.status === 'RUNNING' ? new Date() : null,
      ['DONE', 'FAILED', 'SKIPPED'].includes(update.status) ? new Date() : null,
      update.result ? JSON.stringify(update.result) : null,
      update.error ?? null,
    ])
  }

  private async completeTask(taskId: string, lastStep: number, partial: boolean): Promise<void> {
    const status = partial ? 'PARTIAL' : 'DONE'
    const progress = 100
    await this.db.query(`
      UPDATE agent.tasks SET status = $2, progress = $3, result = $4, finished_at = NOW() WHERE task_id = $1
    `, [taskId, status, progress, JSON.stringify({ lastStep, partial })])
    await this.notifier.push({
      type: 'task_update', conversationId: null,
      payload: { taskId, status, lastStep },
    })
  }

  private async failTask(taskId: string, errorMsg: string): Promise<void> {
    await this.db.query(`
      UPDATE agent.tasks SET status = 'FAILED', error = $2, finished_at = NOW() WHERE task_id = $1
    `, [taskId, JSON.stringify({ message: errorMsg })])
    await this.notifier.push({
      type: 'task_update', conversationId: null,
      payload: { taskId, status: 'FAILED', error: errorMsg },
    })
  }

  async getStatus(taskId: string): Promise<TaskRow | null> {
    const { rows } = await this.db.query(`SELECT * FROM agent.tasks WHERE task_id = $1`, [taskId])
    return rows[0] ?? null
  }

  async cancel(taskId: string): Promise<void> {
    await this.db.query(`
      UPDATE agent.tasks SET status = 'CANCELLED', finished_at = NOW()
      WHERE task_id = $1 AND status IN ('QUEUED', 'RUNNING')
    `, [taskId])
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
```

- [ ] **Step 4: 写 handlers/weekly-bank-review.ts (业务 skill 的任务实现)**

```ts
// agent/src/tasks/handlers/weekly-bank-review.ts
import { registerTaskHandler } from '../registry.ts'
import type { TaskRow, TaskStepUpdate } from '../types.ts'
import type { McpBridge } from '../../mcp/bridge.ts'

export function registerWeeklyBankReview(mcpBridge: McpBridge): void {
  registerTaskHandler('weekly_bank_review', async function* (task: TaskRow): AsyncGenerator<TaskStepUpdate> {
    const brand = task.input?.brand ?? null

    yield { stepIndex: 1, description: '获取 KPI 概览', status: 'RUNNING' }
    const kpi = await mcpBridge.call('get_pipeline_kpi', { brand }, task.user_id ?? 'system')
    yield { stepIndex: 1, status: kpi.success ? 'DONE' : 'FAILED', result: kpi.data, error: kpi.error }

    yield { stepIndex: 2, description: '拉取未分类文件', status: 'RUNNING' }
    const files = await mcpBridge.call('get_unclassified_by_file', { brand, limit: 10 }, task.user_id ?? 'system')
    yield { stepIndex: 2, status: files.success ? 'DONE' : 'FAILED', result: files.data }

    // 后续 step 在 v1.1 补全 (拉明细 + 提 proposal)
  })
}
```

- [ ] **Step 5: 写 scheduler.test.ts**

```ts
// agent/src/tasks/scheduler.test.ts
import { test, before } from 'node:test'
import { strict as assert } from 'node:assert'
import { TaskScheduler } from './scheduler.ts'
import { registerTaskHandler } from './registry.ts'
import { createTestDb, cleanupTestDb } from '../../test/helpers/mock-db.ts'
import { MockMcpBridge } from '../../test/helpers/mock-mcp.ts'
import { registerWeeklyBankReview } from './handlers/weekly-bank-review.ts'

let pool: any
let mcp: MockMcpBridge
let scheduler: TaskScheduler
let notifications: any[]

before(async () => {
  pool = await createTestDb()
  mcp = new MockMcpBridge()
  registerWeeklyBankReview(mcp)
  notifications = []
  scheduler = new TaskScheduler(pool, { push: async (n) => { notifications.push(n) } }, mcp as any, 1)
})

test('enqueue + run a simple task to completion', async () => {
  await cleanupTestDb(pool)
  // 注册一个简单 handler
  registerTaskHandler('test_simple', async function* (task) {
    yield { stepIndex: 1, description: 'step 1', status: 'RUNNING' }
    yield { stepIndex: 1, status: 'DONE', result: { ok: true } }
  })

  const taskId = await scheduler.enqueue({
    taskType: 'test_simple', input: {}, triggeredBy: 'test',
  })

  scheduler.start()

  // 轮询等完成
  let status: any
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    status = await scheduler.getStatus(taskId)
    if (status && ['DONE', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(status.status)) break
  }

  assert.equal(status.status, 'DONE')

  const { rows: steps } = await pool.query(
    `SELECT * FROM agent.task_steps WHERE task_id = $1 ORDER BY step_index`, [taskId],
  )
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'DONE')
})

test('weekly_bank_review handler runs', async () => {
  await cleanupTestDb(pool)
  mcp.on('get_pipeline_kpi', () => ({ success: true, data: { unclassified: 10 } }))
  mcp.on('get_unclassified_by_file', () => ({ success: true, data: { files: [] } }))

  const taskId = await scheduler.enqueue({
    taskType: 'weekly_bank_review', input: { brand: 'yufeng' }, triggeredBy: 'cron',
  })

  let status: any
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    status = await scheduler.getStatus(taskId)
    if (status && ['DONE', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(status.status)) break
  }

  assert.equal(status.status, 'DONE')
  const { rows: steps } = await pool.query(
    `SELECT * FROM agent.task_steps WHERE task_id = $1 ORDER BY step_index`, [taskId],
  )
  assert.equal(steps.length, 2)
})
```

- [ ] **Step 6: 跑测试**

```bash
cd agent
npm test -- src/tasks/scheduler.test.ts 2>&1 | tail -15
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
cd agent
git add src/tasks/
git commit -m "feat(agent/tasks): TaskScheduler DB queue + AsyncGenerator handler + weekly-bank-review"
```

---

## Task 17: CronChannel

**Files:**
- Create: `agent/src/channels/cron.ts`
- Create: `agent/src/channels/cron.test.ts`

- [ ] **Step 1: 写 cron.ts**

```ts
// agent/src/channels/cron.ts
import cron from 'node-cron'
import type { Channel, IncomingMsg } from './types.ts'
import type { ChannelManager } from './manager.ts'

interface CronEntry {
  schedule: string
  taskType: string
  metadata: Record<string, any>
}

export class CronChannel implements Channel {
  channelId = 'cron' as const
  private tasks: cron.ScheduledTask[] = []
  private entries: CronEntry[] = [
    { schedule: process.env.CRON_WEEKLY_REVIEW ?? '0 9 * * 1', taskType: 'weekly_bank_review', metadata: { brand: null } },
  ]

  constructor(
    private manager: ChannelManager,
    private timezone: string = process.env.CRON_TIMEZONE ?? 'Asia/Shanghai',
  ) {}

  async start(): Promise<void> {
    for (const entry of this.entries) {
      const task = cron.schedule(entry.schedule, async () => {
        const msg: IncomingMsg = {
          channelId: 'cron',
          userId: 'system',
          brand: entry.metadata.brand ?? null,
          conversationId: null,
          content: `运行 ${entry.taskType}`,
          metadata: { ...entry.metadata, taskType: entry.taskType },
        }
        await this.manager.onIncoming(msg)
      }, { timezone: this.timezone })
      this.tasks.push(task)
    }
    console.log(`[cron] scheduled ${this.tasks.length} tasks`)
  }

  async send(): Promise<void> { /* cron 不主动推 */ }
  async stop(): Promise<void> { this.tasks.forEach(t => t.stop()) }
}
```

- [ ] **Step 2: 写 cron.test.ts (验证 schedule 注册)**

```ts
// agent/src/channels/cron.test.ts
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { CronChannel } from './cron.ts'

test('CronChannel can be started and stopped', async () => {
  let received: any[] = []
  const manager = { onIncoming: async (m: any) => { received.push(m) } }
  const ch = new CronChannel(manager as any, 'Asia/Shanghai')
  await ch.start()
  assert.equal(ch['tasks'].length, 1)
  await ch.stop()
  // 不实际等 cron 触发, 跑通 start/stop 即可
  assert.ok(true)
})
```

- [ ] **Step 3: 跑测试**

```bash
cd agent
npm test -- src/channels/cron.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd agent
git add src/channels/cron.ts src/channels/cron.test.ts
git commit -m "feat(agent/channels): CronChannel — 周一 9 点自动巡检"
```

---

## Task 18: server.ts 整合 CronChannel + TaskScheduler

**Files:**
- Modify: `agent/src/server.ts`

- [ ] **Step 1: 加依赖注入**

```ts
// agent/src/server.ts (追加, 在 main() 里)

// ... 前面不变
const { TaskScheduler } = await import('./tasks/scheduler.ts')
const { CronChannel } = await import('./channels/cron.ts')
const { registerWeeklyBankReview } = await import('./tasks/handlers/weekly-bank-review.ts')

// 注册所有任务 handler
registerWeeklyBankReview(mcpBridge)

const scheduler = new TaskScheduler(getPool(), notifier, mcpBridge, parseInt(process.env.TASK_WORKER_COUNT ?? '4', 10))
scheduler.start()

const cronChannel = new CronChannel(manager, process.env.CRON_TIMEZONE ?? 'Asia/Shanghai')
await cronChannel.start()

// shutdown 里加 cronChannel.stop()
const shutdown = async () => {
  // ...
  await cronChannel.stop()
  // ...
}
```

(完整 server.ts 至此应该是 ~50 行, 不再单独列出)

- [ ] **Step 2: 验证 server 跑起来 + 4 服务 compose**

```bash
cd agent
npx tsc --noEmit
WS_PORT=4101 DATABASE_URL=... timeout 5 npx tsx src/server.ts 2>&1 | tail -10
```

Expected: `Agent Service listening on 4101`, `[cron] scheduled 1 tasks`

- [ ] **Step 3: 手动 enqueue 一个任务, 验证 scheduler 跑通**

```bash
# 在 psql 里:
PGPASSWORD=$DB_PASSWORD psql -h db -U postgres -d wdg -c "
INSERT INTO agent.tasks (status, task_type, input, user_id)
VALUES ('QUEUED', 'weekly_bank_review', '{\"brand\": \"yufeng\"}'::jsonb, 'manual-test')
RETURNING task_id;
"
```

Expected: 几秒后该 task status 变 'DONE'

- [ ] **Step 4: Commit**

```bash
cd agent
git add src/server.ts
git commit -m "feat(agent): server.ts 整合 TaskScheduler + CronChannel"
```

---

# W5 — 监控 + 通知 UI + 部署准备

## Task 19: Prometheus metrics

**Files:**
- Create: `agent/src/metrics/server.ts`
- Modify: `agent/src/server.ts` (加 /metrics 端点)

- [ ] **Step 1: 写 metrics/server.ts**

```ts
// agent/src/metrics/server.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client'

const registry = new Registry()

export const llmCallTotal = new Counter({
  name: 'agent_llm_call_total', help: 'LLM calls', labelNames: ['model', 'status'],
  registers: [registry],
})
export const llmLatency = new Histogram({
  name: 'agent_llm_latency_seconds', help: 'LLM call latency', labelNames: ['model'],
  buckets: [0.5, 1, 2, 5, 10, 30], registers: [registry],
})
export const mcpCallTotal = new Counter({
  name: 'agent_mcp_call_total', help: 'MCP tool calls', labelNames: ['tool', 'status'],
  registers: [registry],
})
export const mcpLatency = new Histogram({
  name: 'agent_mcp_latency_seconds', help: 'MCP call latency', labelNames: ['tool'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5], registers: [registry],
})
export const taskStatusGauge = new Gauge({
  name: 'agent_tasks_by_status', help: 'Tasks by status', labelNames: ['status'],
  registers: [registry],
})
export const activeWebsockets = new Gauge({
  name: 'agent_websockets_active', help: 'Active WS connections',
  registers: [registry],
})

export async function getMetrics(): Promise<string> {
  return registry.metrics()
}
```

- [ ] **Step 2: server.ts 加 /metrics 端点**

```ts
// server.ts main() 里
import { getMetrics } from './metrics/server.ts'
app.get('/metrics', async (req, reply) => {
  reply.type('text/plain').send(await getMetrics())
})
```

- [ ] **Step 3: 验证**

```bash
cd agent
WS_PORT=4101 npx tsx src/server.ts &
sleep 2
curl -s http://localhost:4101/metrics | head -10
kill %1
```

Expected: 输出 prometheus 格式 metrics

- [ ] **Step 4: Commit**

```bash
cd agent
git add src/metrics/ src/server.ts
git commit -m "feat(agent/metrics): Prometheus /metrics 端点"
```

---

## Task 20: 通知中心 UI (/u/notifications)

**Files:**
- Create: `ui/src/app/u/notifications/page.tsx`
- Create: `ui/src/app/u/notifications/layout.tsx` (optional)
- Create: `ui/src/app/api/notifications/route.ts` (从 agent 拉任务/通知)
- Create: `ui/src/app/api/notifications/audit/route.ts` (admin 查 audit log)

- [ ] **Step 1: 写 /api/notifications/route.ts (代理 agent)**

```ts
// ui/src/app/api/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = url.searchParams.get('limit') ?? '20'

  // 调 agent 拿 task 列表
  const r = await fetch(`${AGENT_URL}/api/tasks?user_id=${user.id}&limit=${limit}`, {
    headers: { 'x-wdg-user-id': user.id, 'x-wdg-user-role': user.role },
  })
  return NextResponse.json(await r.json())
}
```

- [ ] **Step 2: agent 端补 /api/tasks 端点**

```ts
// agent/src/api/tasks.ts (新建)
import type { FastifyInstance } from 'fastify'
import type { TaskScheduler } from '../tasks/scheduler.ts'

export function registerTaskRoutes(app: FastifyInstance, scheduler: TaskScheduler) {
  app.get('/api/tasks', async (req, reply) => {
    const { user_id, limit } = req.query as any
    if (!user_id) return reply.code(400).send({ error: 'user_id required' })
    const tasks = await scheduler['db'].query(
      `SELECT task_id, task_type, status, progress, created_at, finished_at, result, error
       FROM agent.tasks WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [user_id, parseInt(limit ?? '20', 10)],
    )
    return { tasks: tasks.rows }
  })
}
```

- [ ] **Step 3: 写 /u/notifications 页面**

```tsx
// ui/src/app/u/notifications/page.tsx
import { getSessionUser } from '@/lib/auth-server'
import { redirect } from 'next/navigation'

export default async function NotificationsPage() {
  const user = await getSessionUser(undefined as any)
  if (!user) redirect('/login')

  // SSR 拉数据
  const r = await fetch(`${process.env.AGENT_INTERNAL_URL}/api/tasks?user_id=${user.id}&limit=20`, {
    headers: { 'x-wdg-user-id': user.id, 'x-wdg-user-role': user.role },
    cache: 'no-store',
  })
  const { tasks = [] } = await r.json()

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">通知中心</h1>
      <ul className="space-y-2">
        {tasks.map((t: any) => (
          <li key={t.task_id} className="border rounded p-3">
            <div className="font-mono text-sm">{t.task_type}</div>
            <div className="text-xs text-gray-500">
              状态: {t.status} · 进度: {t.progress}% · {new Date(t.created_at).toLocaleString('zh-CN')}
            </div>
          </li>
        ))}
        {tasks.length === 0 && <li className="text-gray-500">暂无通知</li>}
      </ul>
    </main>
  )
}
```

- [ ] **Step 4: 在 layout 加入口链接**

```tsx
// ui/src/app/u/layout.tsx 找 nav 部分, 加一个链接
<Link href="/u/notifications">通知</Link>
```

- [ ] **Step 5: 验证 build**

```bash
cd ui
npx next build 2>&1 | tail -5
```

Expected: Build successful

- [ ] **Step 6: Commit**

```bash
cd ui
git add src/app/u/notifications/ src/app/api/notifications/
git commit -m "feat(ui): 通知中心 /u/notifications + agent /api/tasks"
```

---

## Task 21: Admin config proxy (前端)

**Files:**
- Modify: `ui/src/app/api/admin/agent-config/route.ts`

- [ ] **Step 1: 改 route.ts 为 5 行 fetch 代理**

```ts
// ui/src/app/api/admin/agent-config/route.ts
// v1: 改为 5 行 fetch 代理, 实际配置存在 Agent 进程
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, assertRole } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

async function proxy(req: NextRequest, method: 'GET' | 'POST' | 'DELETE') {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = method === 'GET' ? undefined : await req.text()
  const r = await fetch(`${AGENT_URL}/api/admin/config`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-wdg-user-id': user.id,
      'x-wdg-user-role': user.role,
    },
    body,
  })
  return NextResponse.json(await r.json())
}

export async function GET(req: NextRequest) { return proxy(req, 'GET') }
export async function POST(req: NextRequest) { return proxy(req, 'POST') }
```

- [ ] **Step 2: agent 端补 /api/admin/config 端点**

```ts
// agent/src/api/admin/config.ts (新建)
import type { FastifyInstance } from 'fastify'
import {
  getAgentConfig, setAgentMd, setParams, setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS,
} from '../../config/store.ts'
import { writeFileSync } from 'fs'
import { AGENT_MD_FILE_PATH } from '../../config/agent-md-loader.ts'

export function registerAdminConfigRoutes(app: FastifyInstance) {
  // 鉴权: 仅 admin
  app.addHook('preHandler', async (req, reply) => {
    const role = req.headers['x-wdg-user-role']
    if (role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
  })

  app.get('/api/admin/config', async () => {
    const cfg = getAgentConfig()
    return {
      success: true,
      agentMdContent: cfg.agentMd,
      params: cfg.params,
      defaultParams: DEFAULT_PARAMS,
      model: cfg.model,
      hasApiKey: cfg.apiKey !== null,
      dirty: false,
    }
  })

  app.post<{ Body: { agentMd?: string; params?: any; credentials?: any } }>('/api/admin/config', async (req) => {
    const { agentMd, params, credentials } = req.body

    if (agentMd !== undefined) {
      setAgentMd(agentMd)
      try { writeFileSync(AGENT_MD_FILE_PATH, agentMd, 'utf-8') } catch (e) {
        console.error('[admin/config] write agent.md failed:', e)
      }
    }
    if (params) setParams(params)
    if (credentials) setCredentialConfig(credentials.baseURL, credentials.apiKey, credentials.model)

    return { success: true, message: 'config updated' }
  })

  app.post('/api/admin/config/reset', async () => {
    resetAgentConfig()
    return { success: true }
  })
}
```

- [ ] **Step 3: 验证 build + 跑通**

```bash
cd ui
npx next build 2>&1 | tail -3
cd ../agent
npx tsc --noEmit
```

Expected: Both pass

- [ ] **Step 4: Commit (2 commits)**

```bash
cd ui
git add src/app/api/admin/agent-config/route.ts
git commit -m "refactor(ui): admin config API 改为 5 行 fetch 代理"

cd ../agent
git add src/api/
git commit -m "feat(agent/api): /api/admin/config 端点 (接收 v0 admin UI 代理)"
```

---

## Task 22: Docker Compose + .env.example

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example` (项目根)

- [ ] **Step 1: 改 docker-compose.yml, 加 agent service**

```yaml
# docker-compose.yml (在 services: 下追加)
  agent:
    build: ./agent
    container_name: wdg-agent
    environment:
      - WS_PORT=4101
      - DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db:5432/wdg
      - MCP_ENDPOINT=http://ui:4100/api/mcp
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-claude-opus-4-8}
      - CRON_TIMEZONE=Asia/Shanghai
      - CRON_WEEKLY_REVIEW=0 9 * * 1
      - TASK_WORKER_COUNT=4
      - LOG_LEVEL=info
    depends_on:
      db:
        condition: service_healthy
      ui:
        condition: service_started
    volumes:
      - ./agent/skills:/app/skills:ro
      - ./agent/agent.md:/app/agent.md:ro
    ports:
      - "4101:4101"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://localhost:4101/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 2: 改 .env.example**

```bash
# 追加到 .env.example
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-opus-4-8
NEXT_PUBLIC_AGENT_WS_URL=ws://agent:4101/ws
NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=0
```

- [ ] **Step 3: 改 ui service, 加 AGENT env**

```yaml
# docker-compose.yml 的 ui service 里
  ui:
    # ... 既有
    environment:
      # 追加
      - AGENT_INTERNAL_URL=http://agent:4101
      - NEXT_PUBLIC_AGENT_WS_URL=ws://agent:4101/ws
      - NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=${NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT:-0}
    depends_on:
      agent:
        condition: service_started
```

- [ ] **Step 4: 验证 compose up 起 4 个服务**

```bash
docker compose up -d
sleep 10
docker compose ps
curl -s http://localhost:4101/health
curl -s http://localhost:4101/metrics | head -3
```

Expected: 4 个服务都 running, health 返回 `{"status":"ok"}`, metrics 有数据

- [ ] **Step 5: 跑 DDL (如果新建 DB)**

```bash
docker compose exec db psql -U postgres -d wdg -f /docker-entrypoint-initdb.d/00_agent_schema.sql
# 或
docker compose exec -T db psql -U postgres -d wdg < sql/00_agent_schema.sql
```

Expected: 5 张表建好

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(deploy): docker-compose 加 agent service, 4 服务拓扑"
```

---

## Task 23: E2E 测试 (Playwright)

**Files:**
- Create: `ui/tests/e2e/agent-chat-flow.test.ts`

- [ ] **Step 1: 写 E2E 测试**

```ts
// ui/tests/e2e/agent-chat-flow.test.ts
import { test, expect } from '@playwright/test'

test('B 用户在 ChatDrawer 问问题, Agent 回应', async ({ page }) => {
  // 前提: AGENT_ROLLOUT_PERCENT=100 (走 agent)
  // 真实跑 LLM, 慢, 跑通就行

  await page.goto('http://localhost:4100/login')
  await page.fill('[name=email]', 'analyst@wdg.com')
  await page.fill('[name=password]', 'test-password')
  await page.click('button[type=submit]')

  // 等登录
  await page.waitForURL(/\/u/)

  // 打开 ChatDrawer
  await page.keyboard.press('Control+K')

  // 输入
  await page.fill('[data-testid=chat-input]', '蜜可诗上月财务')
  await page.press('[data-testid=chat-input]', 'Enter')

  // 等 Agent 回应 (最多 30s, 真实 LLM)
  await expect(page.locator('[data-testid=chat-bubble-assistant]').first()).toBeVisible({ timeout: 30_000 })
})
```

- [ ] **Step 2: 跑 E2E (用真 LLM, 慢)**

```bash
cd ui
AGENT_ROLLOUT_PERCENT=100 ANTHROPIC_API_KEY=sk-... npx playwright test tests/e2e/agent-chat-flow.test.ts
```

Expected: PASS (1-2 分钟)

- [ ] **Step 3: Commit**

```bash
cd ui
git add tests/e2e/agent-chat-flow.test.ts
git commit -m "test(e2e): ChatDrawer → Agent Service 真实链路"
```

---

## Task 24: 文档更新

**Files:**
- Modify: `README.md`
- Modify: `docs/LOCAL_STARTUP.md`
- Create: `docs/agent-service.md` (新)

- [ ] **Step 1: 改 README.md, 加 Agent Service 章节**

```markdown
# 在 "## Development Commands" 之后, 加:

## Agent Service

新增的独立 Node.js 进程, 提供 Agent 能力:
- WebSocket 端点: `ws://agent:4101/ws`
- JSON-RPC MCP: 通过既有 `/api/mcp` 复用
- 短期记忆: PG `agent.conversations` / `agent.messages`
- 任务队列: PG `agent.tasks` / `agent.task_steps`
- Skills: `agent/skills/*.md` (Y 方案按需加载)

启动:
```bash
docker compose up -d agent
```

调试:
```bash
docker compose logs -f agent
```

详见 [docs/agent-service.md](docs/agent-service.md) 和 [docs/superpowers/specs/2026-06-08-agent-first-product.md](docs/superpowers/specs/2026-06-08-agent-first-product.md).
```

- [ ] **Step 2: 写 docs/agent-service.md**

```markdown
# Agent Service

## 架构
[粘贴 design-sketches/07 的 5 层架构图简化版]

## 启动
[docker compose 命令]

## 添加新 Skill
1. 写 `agent/skills/<name>.md`, 含 YAML frontmatter (`name`, `description`, `triggers?`)
2. 重启 agent (下一步加 hot reload)

## 添加新任务类型
1. 在 `agent/src/tasks/handlers/` 写一个 handler, AsyncGenerator
2. `registerTaskHandler('type_name', handler)`
3. 在 `server.ts` 注册
4. 在 `agent/src/channels/cron.ts` 加 cron 表达式 (如果定时)

## 监控
- `/metrics` 端点: Prometheus
- `/u/notifications` 页面: 任务列表
- audit log: `agent.audit_log` 表

## 切流
通过 `NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT` env 控制:
- 0 = 所有人走 v0 chat
- 100 = 所有人走 agent
- 其他 = 按 user_id 哈希分流
```

- [ ] **Step 3: 更新 LOCAL_STARTUP.md**

在末尾加:
```markdown
## Agent Service (v1 新增)

启动后, 验证:
```bash
curl http://localhost:4101/health    # {"status":"ok"}
curl http://localhost:4101/metrics   # prometheus 格式
```

切流到 agent:
```bash
# .env 改 NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=100
docker compose restart ui
```

回滚:
```bash
# 改回 0
docker compose restart ui
```
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/agent-service.md docs/LOCAL_STARTUP.md
git commit -m "docs: Agent Service 文档 (启动 / 加 Skill / 加任务 / 切流)"
```

---

## Task 25: 5 阶段切流的 rollout 脚本

**Files:**
- Create: `scripts/rollout-agent.sh`

- [ ] **Step 1: 写脚本**

```bash
#!/bin/bash
# scripts/rollout-agent.sh
# 5 阶段切流工具
# 用法: ./scripts/rollout-agent.sh <0|10|50|100>

set -e
PERCENT=$1

if [[ ! "$PERCENT" =~ ^(0|10|50|100)$ ]]; then
  echo "Usage: $0 <0|10|50|100>"
  exit 1
fi

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo ".env not found"
  exit 1
fi

# 1. 改 .env
if grep -q "NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=" "$ENV_FILE"; then
  sed -i '' "s/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=.*/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=$PERCENT/" "$ENV_FILE"
else
  echo "NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=$PERCENT" >> "$ENV_FILE"
fi

echo "Set NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=$PERCENT in $ENV_FILE"

# 2. 重启 ui 让 env 生效
docker compose restart ui

echo "Restarted ui. Verify:"
sleep 3
docker compose exec ui env | grep AGENT_ROLLOUT || true
```

- [ ] **Step 2: 加可执行权限 + commit**

```bash
chmod +x scripts/rollout-agent.sh
git add scripts/rollout-agent.sh
git commit -m "feat(scripts): rollout-agent.sh 切流工具"
```

---

## Task 26: 最终验收

- [ ] **Step 1: 跑全测试**

```bash
cd agent
npm test 2>&1 | tail -10
echo "---"
cd ../ui
npx next build 2>&1 | tail -3
echo "---"
cd ..
pytest tests/ -v 2>&1 | tail -5
```

Expected: 全部通过

- [ ] **Step 2: 4 服务全起**

```bash
docker compose up -d
sleep 10
docker compose ps
```

Expected: db / ui / agent / metabase 4 个都 running

- [ ] **Step 3: 健康检查**

```bash
curl http://localhost:4100/api/health 2>/dev/null
curl http://localhost:4101/health
curl http://localhost:4101/metrics | head -3
```

Expected: 都正常

- [ ] **Step 4: Agent 表都建好**

```bash
docker compose exec db psql -U postgres -d wdg -c "\dt agent.*"
```

Expected: 5 张表

- [ ] **Step 5: 手动 enqueue 一个 weekly_bank_review 任务, 验证跑通**

```bash
docker compose exec db psql -U postgres -d wdg -c "
INSERT INTO agent.tasks (status, task_type, input, user_id)
VALUES ('QUEUED', 'weekly_bank_review', '{\"brand\":\"yufeng\"}'::jsonb, 'final-test')
RETURNING task_id;
"
sleep 5
docker compose exec db psql -U postgres -d wdg -c "SELECT task_id, status, progress FROM agent.tasks ORDER BY created_at DESC LIMIT 1;"
```

Expected: status='DONE', progress=100

- [ ] **Step 6: 访问 /u/notifications, 看到任务**

打开 http://localhost:4100/u/notifications, 登录, 应该看到刚跑的任务.

- [ ] **Step 7: 标记 v1 完成**

```bash
git tag v1.0-agent-first
git log --oneline -30
```

- [ ] **Step 8: 跟 spec §9 验收标准对一遍**

打开 `docs/superpowers/specs/2026-06-08-agent-first-product.md` §9, 每条 ✓ 确认.

---

## 完成检查表 (跟 spec §9 验收标准对齐)

- [ ] 架构: docker compose up -d 起 4 服务, agent health check 通过
- [ ] 配置迁移: admin 改 maxTokens, 下一个 WS 消息生效
- [ ] Skill 跑通: 5 个 skill 各跑通至少 1 次真实数据
- [ ] Cron 主动能力: 周一 9 点 admin 看到 weekly_bank_review 报告
- [ ] 任务队列: 提交任务, 进度能在 UI 实时看到
- [ ] 错误处理: 5 类错误源各自验证
- [ ] 测试: npm test 跑通, 覆盖率 ≥ 75%
- [ ] 既有项目不退化: pytest + next build 都 pass
- [ ] 监控: /metrics 端点暴露 12+ 指标
- [ ] 审计: admin 能在 /u/notifications 查 audit log
- [ ] 文档: spec + 19 sketch + 更新过的 README

---

**Plan 完成。Saved to `docs/superpowers/plans/2026-06-08-agent-first-product.md`**
