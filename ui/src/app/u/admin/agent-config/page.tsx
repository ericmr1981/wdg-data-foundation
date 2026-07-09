// ui/src/app/u/admin/agent-config/page.tsx
// Phase 5: initial config 改为 SSR 时 fetch /api/admin/agent-config (那个 endpoint 会代理 Agent)
// 这意味着所有 admin 配置读写全在 Agent 端, UI 是只调试用的 admin UI。

import { ClientAgentConfig } from './ClientAgentConfig';

export const dynamic = 'force-dynamic';

async function loadInitialConfig() {
  // server component fetch 自己的 API (SSR 阶段)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3001'
  // 注意: SSR 阶段调用 /api/admin/agent-config 需要 admin session cookie,
  // 这里走服务端到 Agent 的代理 fetch (不走 cookie,但还是要 admin role 校验)
  const res = await fetch(
    `${baseUrl}/api/admin/agent-config`,
    { headers: { 'x-wdg-user-role': 'admin' }, cache: 'no-store' },
  )
  if (!res.ok) {
    return {
      agentMd: '',
      params: {},
      baseURL: null,
      apiKeyMasked: null,
      model: 'claude-opus-4-8',
    }
  }
  const data = await res.json()
  return {
    agentMd: data.agentMd ?? '',
    params: data.params ?? {},
    baseURL: data.baseURL ?? null,
    apiKeyMasked: data.apiKeyMasked ?? null,
    model: data.model ?? 'claude-opus-4-8',
  }
}

export default async function Page() {
  const initial = await loadInitialConfig();
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
        <ClientAgentConfig initial={initial} defaultParams={initial.params} />
      </main>
    </div>
  );
}
