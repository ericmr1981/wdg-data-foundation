// ui/src/lib/chat/agent-config-store.ts
// Spec §4.2: in-memory store for project-level agent config (custom instructions
// + tunables). Not persisted in v1. Next.js and node --test both find the
// default agent.md because we resolve relative to this file, not process.cwd().

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setTokenLimits } from './token-tracker.ts';
import { setRateLimitMax } from './rate-limit.ts';

export interface AgentConfigParams {
  maxTokens: number;
  temperature: number;
  topP: number | null;
  maxToolChainDepth: number;
  rateLimitMaxPerMinute: number;
  tokenSoftLimit: number;
  tokenHardLimit: number;
  mcpRetryMaxAttempts: number;
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

let current: AgentConfig = {
  agentMd: loadDefaultAgentMd(),
  params: { ...DEFAULT_PARAMS },
  baseURL: null,
  apiKey: null,
  model: 'claude-opus-4-8',
};

export function getAgentConfig(): AgentConfig {
  return current;
}

export function setAgentMd(content: string): void {
  current = { ...current, agentMd: content };
}

export function setParam<K extends keyof AgentConfigParams>(
  key: K,
  value: AgentConfigParams[K],
): void {
  current = { ...current, params: { ...current.params, [key]: value } };
}

export function setParams(params: Partial<AgentConfigParams>): void {
  current = { ...current, params: { ...current.params, ...params } };
}

export function setCredentialConfig(
  baseURL: string | null,
  apiKey: string | null,
  model: string,
): void {
  current = { ...current, baseURL, apiKey, model };
}

export function getBaseURL(): string | null { return current.baseURL; }
export function getApiKey(): string | null { return current.apiKey; }
export function getModel(): string { return current.model; }

export function resetAgentConfig(): void {
  current = {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: null,
    apiKey: null,
    model: 'claude-opus-4-8',
  };
}

/**
 * Push the store's token-limit + rate-limit params into the module-level
 * globals used by token-tracker / rate-limit. Call once at the top of each
 * request handler so /api/admin/agent-config updates take effect on the next
 * request.
 */
export function applyConfigToGlobals(): void {
  const p = current.params;
  setTokenLimits(p.tokenSoftLimit, p.tokenHardLimit);
  setRateLimitMax(p.rateLimitMaxPerMinute);
}

export const AGENT_MD_FILE_PATH = AGENT_MD_PATH;
