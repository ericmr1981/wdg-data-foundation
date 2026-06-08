// agent/src/config/store.ts
// ConfigStore — Agent 进程内的配置存储 (复制自 v0 ui/src/lib/chat/agent-config-store.ts)
// 保持 API 兼容, 单一来源, 进程内 in-memory, 鉴权由 admin API 调用方负责

import { loadDefaultAgentMd } from './agent-md-loader.ts'

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
