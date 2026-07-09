// agent/src/config/store.ts
// ConfigStore — Agent 进程内配置存储 (复制自 v0 ui/src/lib/chat/agent-config-store.ts)
// Phase 1 升级: 加 DB 路径 (env 退路)
// 读取优先级: agent.config (DB) → process.env (legacy fallback) → default
// 加密: encrypted_key 列用 AGENT_CRED_ENCRYPTION_KEY AES-256-GCM 加密

import { loadDefaultAgentMd } from './agent-md-loader.js'
import { decrypt } from '../crypto/secret-crypto.js'
import { getPool } from '../db.js'

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
  /**
   * config 来源 (admin API 用来判断是否可编辑 / 是否缺 key)
   * - 'db'    : 从 agent.config 表读出来
   * - 'env'   : DB 没行或读失败,fallback 到 process.env
   * - 'default' : 啥也没有,初始化默认值 (apiKey=null, 需要去 admin 配)
   */
  source: 'db' | 'env' | 'default'
}

// ─── defaults ───────────────────────

function defaultConfig(): AgentConfig {
  return {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: null,
    apiKey: null,
    model: 'claude-opus-4-8',
    source: 'default',
  }
}

function envConfig(): AgentConfig {
  return {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: process.env.ANTHROPIC_BASE_URL ?? null,
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    source: 'env',
  }
}

// ─── DB 读取 ───────────────────────

interface DbConfigRow {
  base_url: string | null
  encrypted_key: string | null
  model: string | null
  params: AgentConfigParams | null
  agent_md: string | null
}

/**
 * 同步尝试从 DB 读 config;若 DB 不可用或无行,返回 null。
 * 函数是 async 因为 DB 调用本质异步。
 */
async function loadFromDb(): Promise<AgentConfig | null> {
  try {
    const { rows } = await getPool().query<DbConfigRow>(`
      SELECT base_url, encrypted_key, model, params, agent_md
      FROM agent.config
      WHERE id = 1
    `)
    if (rows.length === 0) return null

    const row = rows[0]!
    let apiKey: string | null = null
    const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY
    if (row.encrypted_key) {
      if (!encKey) {
        console.warn('[config] agent.config has encrypted_key but AGENT_CRED_ENCRYPTION_KEY env not set')
      } else {
        try {
          apiKey = decrypt(row.encrypted_key, encKey)
        } catch (e) {
          console.error('[config] decrypt failed (wrong key?):', (e as Error).message)
        }
      }
    }

    return {
      agentMd: row.agent_md ?? loadDefaultAgentMd(),
      params: row.params ?? { ...DEFAULT_PARAMS },
      baseURL: row.base_url,
      apiKey,
      model: row.model ?? 'claude-opus-4-8',
      source: 'db',
    }
  } catch (e) {
    console.error('[config] loadFromDb error:', (e as Error).message)
    return null
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
export function getConfigSource(): AgentConfig['source'] { return slot.current.source }

/**
 * server.ts 启动时必须 await 这个函数。
 * 读取顺序: agent.config (DB) → process.env (fallback) → default
 */
export async function initAgentConfig(): Promise<void> {
  // 1. Try DB
  const dbCfg = await loadFromDb()
  if (dbCfg) {
    slot.current = dbCfg
    return
  }
  // 2. Fallback env
  if (process.env.ANTHROPIC_API_KEY) {
    slot.current = envConfig()
    return
  }
  // 3. Default (key=null, admin UI 应引导配)
  slot.current = defaultConfig()
}

/** 重新读 DB(给 admin GET 用,跟 in-memory cache 同步) */
export async function reloadFromDb(): Promise<AgentConfig | null> {
  const cfg = await loadFromDb()
  if (cfg) slot.current = cfg
  return cfg
}

// ─── 写 (in-memory + 同步, 不写 DB) ──
// 注: admin/config.ts 路由负责把 setCredentialConfig + 写 DB 的语义包成原子操作。

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
