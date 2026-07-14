// ui/src/app/u/admin/mcp-status/page.tsx
// MCP 后端连接状态监控

import { McpStatusPanel } from '@/components/admin/McpStatusPanel';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">MCP 后端状态</h1>
        <p className="text-xs text-gray-500">
          实时监控 MCP 后端连接状态，每 10 秒自动刷新
        </p>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <McpStatusPanel />
      </main>
    </div>
  );
}
