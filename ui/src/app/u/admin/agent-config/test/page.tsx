// ui/src/app/u/admin/agent-config/test/page.tsx
// Phase 6: 测试聊天子页 — 调 Agent 当前配置的 key/model/baseURL 发一条 message。
// admin 改完 Agent 配置后, 来这里验证 key 是否生效、模型是否能响应。

import { TestChatClient } from './TestChatClient';

export const dynamic = 'force-dynamic';

// SSR — 调 Agent 拿初始 (model, baseURL) 状态, 在客户端展示"用的是什么配置"
async function loadAgentStatus() {
  const baseUrl = process.env.AGENT_INTERNAL_URL || 'http://127.0.0.1:4101';
  try {
    const res = await fetch(`${baseUrl}/api/admin/config`, {
      headers: { 'x-wdg-user-role': 'admin' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    return {
      source: body.source as string | null,
      model: body.model as string | null,
      baseURL: body.baseUrl as string | null,
      hasApiKey: body.hasApiKey === true,
    };
  } catch {
    return null;
  }
}

export default async function Page() {
  const status = await loadAgentStatus();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Agent 调试 — Test Chat</h1>
        <p className="text-xs text-gray-500">
          调 Agent 当前生效的 key/model/baseURL 直接发一条消息。
          改完 Agent 配置 → 来这里验证。
        </p>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-6">
        <div className="mb-4 rounded border border-gray-200 bg-white p-4 text-sm">
          <div><strong>当前 Agent 配置:</strong></div>
          {status ? (
            <ul className="mt-2 space-y-1 text-gray-600">
              <li>source: <code>{status.source ?? '(unknown)'}</code></li>
              <li>model: <code>{status.model ?? '(unknown)'}</code></li>
              <li>baseURL: <code>{status.baseURL ?? '(default Anthropic)'}</code></li>
              <li>apiKey: {status.hasApiKey ? '✅ 已配' : '❌ 未配'}</li>
            </ul>
          ) : (
            <div className="mt-2 text-red-600">Agent 不可达 — 检查 wdg-agent.service</div>
          )}
        </div>
        <TestChatClient />
        <p className="mt-6 text-xs text-gray-400">
          路径: <a href="/u/admin/agent-config" className="text-blue-600 hover:underline">/u/admin/agent-config</a>
          {' ← '}
          <a href="/u/admin/agent-config/test" className="font-semibold text-blue-600">test</a>
        </p>
      </main>
    </div>
  );
}
