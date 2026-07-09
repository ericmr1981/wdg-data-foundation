// ui/src/lib/chat/agent-config-store.ts
// Spec §4.2: in-memory store for project-level agent config (custom instructions
// + tunables). Not persisted in v1. Next.js and node --test both find the
// default agent.md because we resolve relative to this file, not process.cwd().

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import { setTokenLimits } from './token-tracker.ts';
import { setRateLimitMax } from './rate-limit.ts';

/**
 * Anthropic extended thinking level. 'off' disables the feature entirely;
 * the other levels map to increasing `budget_tokens` for the model's
 * internal reasoning pass.
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

/** Per-level `budget_tokens` (Anthropic requires >= 1024 and < max_tokens). */
export const THINKING_BUDGET: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  low: 1024,
  medium: 8192,
  high: 16384,
};

/**
 * Build the Anthropic `thinking` parameter from a level. Returns null for
 * 'off' (caller should omit the key) or a ThinkingConfigEnabled object.
 *
 * The `max_tokens` constraint is NOT enforced here — the caller is
 * responsible for ensuring `cfg.params.maxTokens > budget_tokens`. The UI
 * help text documents the constraint; the Anthropic API will return a
 * validation error if violated (forwarded to the client as an SSE error).
 */
export function thinkingConfigFor(level: ThinkingLevel): Anthropic.ThinkingConfigParam | null {
  if (level === 'off') return null;
  return { type: 'enabled', budget_tokens: THINKING_BUDGET[level] };
}

export interface AgentConfigParams {
  maxTokens: number;
  temperature: number;
  topP: number | null;
  maxToolChainDepth: number;
  rateLimitMaxPerMinute: number;
  tokenSoftLimit: number;
  tokenHardLimit: number;
  mcpRetryMaxAttempts: number;
  thinkingLevel: ThinkingLevel;
}

export interface AgentConfig {
  agentMd: string;
  params: AgentConfigParams;
  baseURL: string | null;
  apiKey: string | null;
  model: string;
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
};

// Resolve agent.md relative to THIS file so both `node --test` (cwd=ui/) and
// Next.js (cwd=project root) find the same file. As a fallback, also check
// process.cwd()-relative paths in case the file is symlinked or moved.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATHS = [
  join(__dirname, 'agent.md'),
  join(process.cwd(), 'ui', 'src', 'lib', 'chat', 'agent.md'),
  join(process.cwd(), 'src', 'lib', 'chat', 'agent.md'),
];

const AGENT_MD_PATH =
  CANDIDATE_PATHS.find((p) => existsSync(p)) ?? CANDIDATE_PATHS[0];

function loadDefaultAgentMd(): string {
  try {
    return readFileSync(AGENT_MD_PATH, 'utf-8');
  } catch {
    return '# 项目级 Agent 指令\n\n（默认 agent.md 加载失败）\n';
  }
}

// Singleton persisted on globalThis. Next.js dev HMR re-evaluates this module
// for every route handler it serves (admin/agent-config and chat have
// independent bundles in dev mode), which would otherwise create a fresh
// `current` per route and silently lose admin-saved credentials when the
// chat route reads them. Using globalThis as the backing store keeps a
// single instance across the whole Node process.
//
// Phase 4 / Phase 2 收敛:
//   UI 端不再维护自己的加密 key 存储。
//   Agent (Fastify) 有自己的 agent.config 表 — 是 LLM API key 的 source of truth。
//   UI 这边的 in-memory cache 只用来:
//     - 读 in-process 调整过的 params (temperature/maxTokens 等)
//     - 这进程没设 env 时 fallback 到 env
//   重启 UI 进程,params 重新读 DEFAULT_PARAMS;key 重新从 env 读。
//
// 历史注释 (v2):
//   v2 把 params + 加密 key 写到 ops.chat_agent_credentials.params (JSONB),
//   在 process startup 时 hydrate。Phase 4 删表,这段逻辑也跟着删了。
type AgentConfigSlot = { current: AgentConfig };

const SLOT_KEY = '__wdg_agent_config__';
const g = globalThis as unknown as { [SLOT_KEY]?: AgentConfigSlot };

function defaultConfig(): AgentConfig {
  return {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: null,
    apiKey: null,
    model: 'claude-opus-4-8',
  };
}

const slot: AgentConfigSlot = (g[SLOT_KEY] ??= { current: defaultConfig() });

/**
 * Phase 4: ops.chat_agent_credentials 已删。保留这个 hook 是为了不破坏 import
 * signature,内部什么都不做。
 */
export async function hydrateConfigFromDb(_pool?: any): Promise<void> {
  // no-op
}

/**
 * Phase 4: UI 端不再持久化 params/creds 到 DB。配置由 Agent 端的 agent.config 管理
 * (Phase 1 引入)。UI 修改只活在 in-memory,UI 重启后会回到 DEFAULT_PARAMS / env。
 */
export async function persistConfigToDb(
  _pool?: any,
  _userId?: string,
): Promise<void> {
  // no-op (ops.chat_agent_credentials removed in Phase 4)
}

export function getAgentConfig(): AgentConfig {
  return slot.current;
}

export function setAgentMd(content: string): void {
  slot.current = { ...slot.current, agentMd: content };
}

export function setParam<K extends keyof AgentConfigParams>(
  key: K,
  value: AgentConfigParams[K],
): void {
  slot.current = { ...slot.current, params: { ...slot.current.params, [key]: value } };
}

export function setParams(params: Partial<AgentConfigParams>): void {
  slot.current = { ...slot.current, params: { ...slot.current.params, ...params } };
}

export function setCredentialConfig(
  baseURL: string | null,
  apiKey: string | null,
  model: string,
): void {
  slot.current = { ...slot.current, baseURL, apiKey, model };
}

export function getBaseURL(): string | null { return slot.current.baseURL; }
export function getApiKey(): string | null { return slot.current.apiKey; }
export function getModel(): string { return slot.current.model; }

export function resetAgentConfig(): void {
  slot.current = defaultConfig();
}

/**
 * Push the store's token-limit + rate-limit params into the module-level
 * globals used by token-tracker / rate-limit. Call once at the top of each
 * request handler so /api/admin/agent-config updates take effect on the next
 * request.
 */
export function applyConfigToGlobals(): void {
  const p = slot.current.params;
  setTokenLimits(p.tokenSoftLimit, p.tokenHardLimit);
  setRateLimitMax(p.rateLimitMaxPerMinute);
}

export const AGENT_MD_FILE_PATH = AGENT_MD_PATH;
