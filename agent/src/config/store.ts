// agent/src/config/store.ts
// ConfigStore — Agent 进程内配置存储
// Phase 1: DB-first
// Phase R: env-only 留 AGENT_CRED_ENCRYPTION_KEY (解密 DB 那把 api key)
//         ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 不再从 env 读,
//         完全靠 agent.config DB 表 (admin 页面管理)
//
// 来源策略:
//   - config 来自 DB (agent.config 表,id=1)
//   - 解密种子 AGENT_CRED_ENCRYPTION_KEY 来自 env (systemd EnvironmentFile = /etc/wdg/agent.env)
//   - DB 没行 / DB 读不到 → startAgentConfig 抛错, server.ts 选择 fast-fail (启动失败)
//
// 跟生产部署的关系: 生产 systemd unit 写 /etc/wdg/agent.env, 里面**只放**:
//   DATABASE_URL=postgresql://agent:...
//   AGENT_CRED_ENCRYPTION_KEY=<随机 32+ 字符>
//   MCP_ENDPOINT, ANTHROPIC_MODEL 等已废字段不需要 (默认值在 DEFAULT_PARAMS)
// new install 流程:
//   1. createdb + 建表 (sql/*.sql)
//   2. INSERT agent.config 一次 (seed script) — admin 在 UI 里改 key 也行

import { loadDefaultAgentMd } from './agent-md-loader.js'
import { decrypt } from '../crypto/secret-crypto.js'
import { getPool } from '../db.js'

// ─── 类型 ───────────────────────────

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface ThinkingConfig {
  thinking: { type: 'adaptive' }
  output_config: { effort: 'low' | 'medium' | 'high' }
}

const EFFORT_BY_LEVEL: Record<Exclude<ThinkingLevel, 'off'>, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export function thinkingConfigFor(level: ThinkingLevel): ThinkingConfig | null {
  if (level === 'off') return null
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT_BY_LEVEL[level] },
  }
}

export interface AgentConfigParams {
  maxTokens: number
  /** @deprecated kept for legacy admin UI; runner no longer passes temperature to SDK */
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
   * 配置来源 (admin API 用来判断是否可编辑 / 是否缺 key)
   * - 'db'      : 从 agent.config 表读出来
   * - 'missing' : DB 没 row 或读不出, 启动应该 fail (R 设计下不允许)
   */
  source: 'db' | 'missing'
}

// ─── defaults ───────────────────────

function defaultConfig(): AgentConfig {
  return {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: null,
    apiKey: null,
    model: 'claude-opus-4-8',
    source: 'missing',
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
 * 严格从 DB 读;DB 不可用或没行 → 返回 null。
 * R 设计: 不再读 ANTHROPIC_* env 兜底。
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
        throw new Error(
          'agent.config.encrypted_key exists but AGENT_CRED_ENCRYPTION_KEY env not set — ' +
          'env 必须含解密钥',
        )
      }
      try {
        apiKey = decrypt(row.encrypted_key, encKey)
      } catch (e) {
        throw new Error(
          `decrypt failed (AGENT_CRED_ENCRYPTION_KEY 与 DB 加密时的不一致): ${(e as Error).message}`,
        )
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
 * R 设计: DB-only。失败抛错由 server.ts 决定要不要 fast-fail。
 */
export async function initAgentConfig(): Promise<void> {
  const dbCfg = await loadFromDb()
  if (dbCfg) {
    slot.current = dbCfg
    return
  }
  // DB 读不到 (没 row / 解密失败 / DB 不可达) → 留 defaultConfig() 让 server 决定
  // server.ts 在 main() 开头判断 source==='missing' → 直接退出
  slot.current = defaultConfig()
}

/** 重新读 DB(给 admin GET 用,跟 in-memory cache 同步) */
export async function reloadFromDb(): Promise<AgentConfig | null> {
  const cfg = await loadFromDb()
  if (cfg) slot.current = cfg
  return cfg
}

/**
 * server.ts 启动检查用: 如果 in-memory 是 missing 状态, server 应该 fail-fast
 */
export function isConfigReady(): boolean {
  return slot.current.source === 'db' && !!slot.current.apiKey
}

// ─── 写 (in-memory, admin/config.ts 路由负责把这个写 DB) ──

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
