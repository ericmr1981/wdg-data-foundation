import { getAgentConfig, DEFAULT_PARAMS } from '@/lib/chat/agent-config-store';
import { ClientAgentConfig } from './ClientAgentConfig';

export const dynamic = 'force-dynamic';

// Phase 4: 简化 — UI 不再读 ops.chat_agent_credentials (表已删)。
// 这里的 initial config 完全从 in-memory store + env fallback 来。
async function loadInitialConfig() {
  const cfg = getAgentConfig();
  const apiKey = cfg.apiKey || process.env.ANTHROPIC_API_KEY || null;
  return {
    agentMd: cfg.agentMd,
    params: cfg.params,
    baseURL: cfg.baseURL,
    apiKeyMasked: maskKey(apiKey),
    model: cfg.model,
  };
}

function maskKey(k: string | null): string | null {
  if (!k) return null;
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '***' + k.slice(-4);
}

export default async function Page() {
  const initial = await loadInitialConfig();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Agent 配置 (Admin)</h1>
        <p className="text-xs text-gray-500">编辑 agent.md 自定义提示词 · 调整调试参数 · 配置 Anthropic API · 变更热生效</p>
      </header>
      <main className="mx-auto max-w-5xl">
        <ClientAgentConfig initial={initial} defaultParams={DEFAULT_PARAMS} />
      </main>
    </div>
  );
}
