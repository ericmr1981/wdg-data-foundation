import { getAgentConfig, DEFAULT_PARAMS } from '@/lib/chat/agent-config-store';
import { ClientAgentConfig } from './ClientAgentConfig';

export const dynamic = 'force-dynamic';

export default function Page() {
  const cfg = getAgentConfig();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Agent 配置 (Admin)</h1>
        <p className="text-xs text-gray-500">编辑 agent.md 自定义提示词 · 调整调试参数 · 变更热生效</p>
      </header>
      <main className="mx-auto max-w-5xl">
        <ClientAgentConfig initial={cfg} defaultParams={DEFAULT_PARAMS} />
      </main>
    </div>
  );
}
