'use client';
import { useEffect, useState } from 'react';

interface BackendStatus {
  name: string;
  url: string;
  status: 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'dead';
  toolCount: number;
  lastPingMs: number | null;
  errorCount: number;
  connectedAt: string | null;
  lastError: string | null;
}

interface StatusData {
  backends: BackendStatus[];
  summary: {
    total: number;
    connected: number;
    degraded: number;
    dead: number;
    toolCount: number;
  };
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'text-green-600 bg-green-50 border-green-200',
  degraded: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  connecting: 'text-blue-600 bg-blue-50 border-blue-200',
  disconnected: 'text-gray-600 bg-gray-50 border-gray-200',
  dead: 'text-red-600 bg-red-50 border-red-200',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.disconnected;
  const label = { connecting: '连接中', connected: '已连接', degraded: '不稳定', disconnected: '已断开', dead: '不可用' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
      <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
        status === 'connected' ? 'bg-green-500 animate-pulse' :
        status === 'degraded' ? 'bg-yellow-500' :
        status === 'connecting' ? 'bg-blue-500 animate-pulse' :
        'bg-gray-400'
      }`} />
      {(label as any)[status] ?? status}
    </span>
  );
}

export function McpStatusPanel() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/admin/mcp-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 10_000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        无法获取 MCP 状态: {error}
      </div>
    );
  }

  if (!data) {
    return <div className="text-xs text-gray-400">加载中...</div>;
  }

  const { backends, summary } = data;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
          <div className="text-xs text-gray-500">后端总数</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{summary.connected}</div>
          <div className="text-xs text-gray-500">已连接</div>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{summary.degraded + summary.dead}</div>
          <div className="text-xs text-gray-500">异常</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{summary.toolCount}</div>
          <div className="text-xs text-gray-500">工具数</div>
        </div>
      </div>

      {/* Backend list */}
      <div className="space-y-2">
        {backends.map(b => (
          <div key={b.name} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusBadge status={b.status} />
                <div>
                  <div className="text-sm font-medium text-gray-900">{b.name}</div>
                  <div className="text-xs text-gray-500 font-mono truncate max-w-md">{b.url}</div>
                </div>
              </div>
              <div className="text-right text-xs text-gray-500">
                <div>{b.toolCount} 工具</div>
                {b.lastPingMs !== null && <div>{b.lastPingMs}ms</div>}
              </div>
            </div>
            {b.connectedAt && (
              <div className="mt-2 text-xs text-gray-400">
                连接时间: {new Date(b.connectedAt).toLocaleString('zh-CN')}
              </div>
            )}
            {b.lastError && (
              <div className="mt-2 text-xs text-red-500 bg-red-50 rounded p-2 font-mono">
                {b.lastError}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
