// ui/src/app/u/admin/agent-config/page.tsx
// Phase 5.1: server component 直接调 helper (ui/src/lib/agent-config-proxy.ts),
// 不再 self-fetch /api/admin/agent-config (SSR self-fetch 在 Next.js 不稳)。

import { ClientAgentConfig } from './ClientAgentConfig';
import { fetchAgentConfig } from '@/lib/agent-config-proxy';
import { DEFAULT_PARAMS } from '@/lib/chat/agent-config-store';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const initial = await fetchAgentConfig();
  // Initial params: 用 Agent 端的 defaultParams (已是 typed)
  // 如果 Agent 返回空对象 (Agent 没存), fallback DEFAULT_PARAMS
  const initialParams = (initial.defaultParams && Object.keys(initial.defaultParams as object).length > 0)
    ? (initial.defaultParams as any)
    : DEFAULT_PARAMS;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Agent 配置 (Admin)</h1>
        <p className="text-xs text-gray-500">
          调试 / 管理 Agent 进程配置。改动直接写到 Agent (Fastify :4101),
          持久化在 agent.config 表里。
        </p>
      </header>
      <main className="mx-auto max-w-5xl">
        <div className="px-6 pt-3 text-right">
          <a href="/u/admin/agent-config/test" className="text-xs text-blue-600 hover:underline">
            调试页: Test Chat →
          </a>
        </div>
        <ClientAgentConfig initial={initial as any} defaultParams={initialParams} />
      </main>
    </div>
  );
}
