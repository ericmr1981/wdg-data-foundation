# WDG v1 — ConfigStore 接口设计

> v0 的 `ui/src/lib/chat/agent-config-store.ts` 整体迁过来,保持 API 兼容
> 唯一区别:不再在 Next.js 进程内,而在 Agent Service 进程内

## 1. 类型定义

```typescript
// agent/src/config/store.ts

// ─────────────────────────────────────────────────
// 类型 (从 v0 复制, 不变)
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// 7 个调试参数 (从 v0 复制, 不变)
// ─────────────────────────────────────────────────

export interface AgentConfigParams {
  maxTokens: number                  // 默认 4096
  temperature: number                // 默认 0.3
  topP: number | null                // 默认 null
  maxToolChainDepth: number          // 默认 10
  rateLimitMaxPerMinute: number      // 默认 10
  tokenSoftLimit: number             // 默认 80_000
  tokenHardLimit: number             // 默认 200_000
  mcpRetryMaxAttempts: number        // 默认 2
  thinkingLevel: ThinkingLevel       // 默认 'off'
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

// ─────────────────────────────────────────────────
// 整体配置 (从 v0 复制, 不变)
// ─────────────────────────────────────────────────

export interface AgentConfig {
  agentMd: string
  params: AgentConfigParams
  baseURL: string | null
  apiKey: string | null
  model: string
}

export function defaultConfig(): AgentConfig {
  return {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: null,
    apiKey: null,
    model: 'claude-opus-4-8',
  }
}

// ─────────────────────────────────────────────────
// Store 主体 (从 v0 复制, 不变)
// ─────────────────────────────────────────────────

type AgentConfigSlot = { current: AgentConfig }
const SLOT_KEY = '__wdg_agent_config__'
const g = globalThis as unknown as { [SLOT_KEY]?: AgentConfigSlot }
const slot: AgentConfigSlot = (g[SLOT_KEY] ??= { current: defaultConfig() })

// 读
export function getAgentConfig(): AgentConfig { return slot.current }
export function getBaseURL(): string | null { return slot.current.baseURL }
export function getApiKey(): string | null { return slot.current.apiKey }
export function getModel(): string { return slot.current.model }

// 写
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

// 把配置推到 token-tracker / rate-limit 等子模块的全局变量
export function applyConfigToGlobals(): void {
  // (v0 一样, 略)
}
```

## 2. agent.md 加载

```typescript
// agent/src/config/agent-md-loader.ts
// 从 v0 复制, 唯一区别: 路径解析

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 优先级: 1) agent/agent.md  2) cwd 查找  3) 默认模板
const CANDIDATE_PATHS = [
  join(__dirname, '..', '..', 'agent.md'),         // agent/agent.md
  join(process.cwd(), 'agent', 'agent.md'),
  join(__dirname, 'default-agent.md'),              // 内置默认
]

const AGENT_MD_PATH =
  CANDIDATE_PATHS.find((p) => existsSync(p)) ?? CANDIDATE_PATHS[2]

function loadDefaultAgentMd(): string {
  try {
    return readFileSync(AGENT_MD_PATH, 'utf-8')
  } catch {
    return '# 项目级 Agent 指令\n\n（默认 agent.md 加载失败）\n'
  }
}

export { AGENT_MD_PATH, loadDefaultAgentMd }
```

## 3. Admin API (新增, 但镜像 v0 schema)

```typescript
// agent/src/api/admin/config/route.ts
// 跟 v0 的 ui/src/app/api/admin/agent-config/route.ts 一对一对应

import { FastifyInstance } from 'fastify'
import {
  getAgentConfig, setAgentMd, setParams,
  setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS,
} from '../../config/store'
import { encrypt, decrypt } from '../../config/secret-crypto'

// POST /api/admin/config
// body: { agentMd?, params?, credentials? }
interface AdminConfigUpdateRequest {
  agentMd?: string
  params?: Partial<AgentConfigParams>
  credentials?: {
    baseURL: string | null
    apiKey: string | null
    model: string
  }
}

interface AdminConfigResponse {
  success: boolean
  agentMdContent: string
  params: AgentConfigParams
  defaultParams: AgentConfigParams
  model: string
  hasApiKey: boolean
  dirty: boolean
  message?: string
}

export async function registerAdminConfigRoutes(app: FastifyInstance) {

  // GET — 返回当前配置 (隐藏 apiKey, 只回 hasApiKey)
  app.get('/api/admin/config', async (req, reply) => {
    const cfg = getAgentConfig()
    return {
      success: true,
      agentMdContent: cfg.agentMd,
      params: cfg.params,
      defaultParams: DEFAULT_PARAMS,
      model: cfg.model,
      hasApiKey: cfg.apiKey !== null,
      dirty: false,  // (v0 也有, 暂不深究)
    }
  })

  // POST — 增量更新
  app.post<{ Body: AdminConfigUpdateRequest }>('/api/admin/config', async (req, reply) => {
    const { agentMd, params, credentials } = req.body

    if (agentMd !== undefined) {
      setAgentMd(agentMd)
      // 写回磁盘 (跟 v0 一样)
      // writeFileSync(AGENT_MD_PATH, agentMd, 'utf-8')
    }
    if (params) {
      setParams(params)
    }
    if (credentials) {
      setCredentialConfig(credentials.baseURL, credentials.apiKey, credentials.model)
    }

    applyConfigToGlobals()  // 推给 token-tracker / rate-limit

    return { success: true, ... }
  })

  // POST /reset — 重置
  app.post('/api/admin/config/reset', async (req, reply) => {
    resetAgentConfig()
    applyConfigToGlobals()
    return { success: true, ... }
  })
}
```

## 4. 鉴权

```typescript
// agent/src/api/auth-middleware.ts
// 跟 v0 一样靠 header 透传, 但 Agent Service 不知道 Next.js session,
// 所以验证由 Next.js 侧做, Agent 只信 header

export async function requireAdmin(req, reply) {
  const userId = req.headers['x-wdg-user-id']
  const userRole = req.headers['x-wdg-user-role']

  if (!userId || userRole !== 'admin') {
    return reply.code(403).send({ error: 'Admin only' })
  }
  // 透传到下游
  req.userId = userId
  req.userRole = userRole
}
```

Next.js 侧的 5 行 proxy:
```typescript
// ui/src/app/api/admin/agent-config/route.ts (v1 版本)
export async function GET(req) {
  const r = await fetch('http://agent:4101/api/admin/config', {
    headers: {
      'x-wdg-user-id': getSessionUserId(req),     // 复用 v0 鉴权
      'x-wdg-user-role': getSessionUserRole(req),
    },
  })
  return Response.json(await r.json())
}
// POST / reset 同理
```

## 5. 跟 v0 的兼容性 (重要!)

| 项 | v0 行为 | v1 行为 | 兼容? |
|---|---|---|---|
| TypeScript 类型 | AgentConfigParams 等 | **一字不改** | ✓ |
| 函数名 | getAgentConfig / setParam | **一字不改** | ✓ |
| Admin API schema | { agentMdContent, params, defaultParams, ... } | **一字不改** | ✓ (前端 UI 不动) |
| 鉴权 | Next.js session 内 | header 透传到 Agent | ✓ (前端 UI 不感知) |
| 热生效 | 下一个 /api/chat 请求 | 下一个 WS 消息 / Cron tick | ✓ |
| 全局单例 | globalThis | globalThis (Node.js 也有) | ✓ |

**前端 `AgentConfigEditor.tsx` / `AgentConfigPreview.tsx` / `page.tsx` 三个文件 0 改动**。

## 6. 这个组件你看什么

- **整个文件就是 v0 的复制粘贴** — 工作量在"复制+路径适配", 不在设计
- **类型 / 函数名 / Admin API schema 全部保持 v0 原样** — 这是兼容性关键
- **唯一新增**: `auth-middleware.ts` 的 header 透传 — 因为 Agent Service 不直接读 Next.js session
- **Next.js 侧唯一改动**: 把 admin API 改成 5 行 fetch 代理
