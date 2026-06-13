// ui/src/app/u/agent-test/page.tsx
// Agent Service 调试页: 任何登录用户都能直接调 agent, 看实时 WS 消息.
// 不需要 LLM key 也能用 (会看到 401 错误, 但链路本身 work).
//
// 实际 agent (agent/src/channels/types.ts) 当前通过 WS 发 5 种类型:
//   task_update | task_done | task_failed | system_error | cron_fired
// 旧 spec 里的 text_delta/thinking_delta/tool_call 等类型暂未上 WS,
// 这里只画实际存在的 + 一个 "其他" 兜底. 等 agent 接入流式协议再扩展.

'use client';

import { useEffect, useRef, useState } from 'react';

type Status = 'disconnected' | 'connecting' | 'connected' | 'error';

interface LogEntry {
  ts: number;
  direction: 'send' | 'recv' | 'sys';
  type: string;
  payload: unknown;
  raw: string;
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

const TYPE_BG: Record<string, string> = {
  user: 'bg-blue-50 border-blue-300',
  task_update: 'bg-yellow-50 border-yellow-300',
  task_done: 'bg-green-50 border-green-300',
  task_failed: 'bg-red-50 border-red-300',
  system_error: 'bg-red-100 border-red-500 text-red-900',
  cron_fired: 'bg-purple-50 border-purple-300',
  text_delta: 'bg-gray-50 border-gray-200',
  text_block: 'bg-white border-gray-300',
  thinking_delta: 'bg-blue-50 border-blue-200',
  tool_call: 'bg-yellow-50 border-yellow-300',
  tool_result: 'bg-green-50 border-green-300',
  error: 'bg-red-50 border-red-300',
  info: 'bg-slate-50 border-slate-200',
};

function bgFor(type: string): string {
  return TYPE_BG[type] ?? 'bg-gray-50 border-gray-200';
}

export default function AgentTestPage() {
  const [status, setStatus] = useState<Status>('disconnected');
  const [url, setUrl] = useState<string>('');
  const [input, setInput] = useState<string>('上周怎么样');
  const [brand, setBrand] = useState<string>('yufeng');
  const [userId, setUserId] = useState<string>('agent-test-user');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拉当前 user 填 userId (登录用户真实 id, 不是 hardcode)
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j?.success && j.data?.user_id) setUserId(String(j.data.user_id));
      })
      .catch(() => { /* keep default */ });
  }, []);

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // 推一条系统消息
  const push = (entry: Omit<LogEntry, 'ts'>) => {
    setLogs(prev => [...prev, { ...entry, ts: Date.now() }]);
  };

  const connect = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    const base = process.env.NEXT_PUBLIC_AGENT_WS_URL ?? 'ws://localhost:4102/ws';
    const full = `${base}?userId=${encodeURIComponent(userId)}`;
    setUrl(full);
    setStatus('connecting');
    push({ direction: 'sys', type: 'info', payload: { msg: `connecting → ${full}` }, raw: full });

    let ws: WebSocket;
    try {
      ws = new WebSocket(full);
    } catch (e) {
      setStatus('error');
      push({ direction: 'sys', type: 'error', payload: { error: (e as Error).message }, raw: String(e) });
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      push({ direction: 'sys', type: 'info', payload: { msg: 'connected' }, raw: 'open' });
    };
    ws.onclose = (ev) => {
      setStatus('disconnected');
      push({ direction: 'sys', type: 'info', payload: { code: ev.code, reason: ev.reason }, raw: `close ${ev.code}` });
    };
    ws.onerror = () => {
      setStatus('error');
      push({ direction: 'sys', type: 'error', payload: { msg: 'ws error (see network tab)' }, raw: 'error' });
    };
    ws.onmessage = (ev) => {
      const raw = String(ev.data);
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* keep null */ }
      const type = typeof parsed?.type === 'string' ? parsed.type : 'unknown';
      push({ direction: 'recv', type, payload: parsed?.payload ?? parsed, raw });
    };
  };

  const disconnect = () => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try { ws.close(1000, 'user disconnect'); } catch { /* noop */ }
    }
    wsRef.current = null;
    setStatus('disconnected');
    push({ direction: 'sys', type: 'info', payload: { msg: 'manual disconnect' }, raw: 'disconnect' });
  };

  // 进入页面自动连, 离开自动断
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        try { ws.close(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const send = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      push({ direction: 'sys', type: 'error', payload: { msg: 'ws not open' }, raw: 'no send' });
      return;
    }
    // agent/src/channels/web.ts 期望 { content, brand, conversationId? }
    const payload = { content: input, brand };
    const raw = JSON.stringify(payload);
    ws.send(raw);
    push({ direction: 'send', type: 'user', payload, raw });
    setInput('');
  };

  const clear = () => setLogs([]);

  // 状态色
  const statusColor: Record<Status, string> = {
    disconnected: 'bg-red-500',
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    error: 'bg-red-700',
  };
  const statusLabel: Record<Status, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    connected: 'Connected',
    error: 'Error',
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Agent 调试</h1>
          <p className="mt-1 text-sm text-gray-600">
            直接调 Agent Service WebSocket, 看实时消息. 不需要 LLM key 也能测链路 (会看到 401).
          </p>
        </header>

        <div className="mb-3 flex items-center gap-3 rounded border border-gray-200 bg-white px-4 py-2">
          <span className={`inline-block h-3 w-3 rounded-full ${statusColor[status]}`} />
          <span className="font-mono text-sm text-gray-700">{statusLabel[status]}</span>
          <span className="ml-2 truncate font-mono text-xs text-gray-400">{url}</span>
          <div className="ml-auto flex gap-2">
            {status === 'connected' || status === 'connecting' ? (
              <button
                onClick={disconnect}
                className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
              >Disconnect</button>
            ) : (
              <button
                onClick={connect}
                className="rounded border border-blue-500 bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600"
              >Connect</button>
            )}
            <button
              onClick={clear}
              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >Clear</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 左: 输入 */}
          <div className="flex flex-col rounded border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">输入</h2>
            <label className="mb-1 text-xs text-gray-500">userId (从 /api/auth/me 拉)</label>
            <input
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="mb-3 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
            <label className="mb-1 text-xs text-gray-500">brand</label>
            <select
              value={brand}
              onChange={e => setBrand(e.target.value)}
              className="mb-3 rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="yufeng">yufeng</option>
              <option value="bonjur">bonjur</option>
              <option value="gelatomiiix">gelatomiiix</option>
              <option value="tamkoko">tamkoko</option>
            </select>
            <label className="mb-1 text-xs text-gray-500">content (用户消息)</label>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              rows={6}
              className="mb-3 flex-1 resize-none rounded border border-gray-300 px-2 py-1 font-mono text-sm"
              placeholder="例如: 上周怎么样"
            />
            <button
              onClick={send}
              disabled={status !== 'connected' || !input.trim()}
              className="rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300"
            >Send</button>
            <p className="mt-2 text-[11px] text-gray-400">
              WS URL: <code>{process.env.NEXT_PUBLIC_AGENT_WS_URL ?? 'ws://localhost:4102/ws'}</code>
            </p>
          </div>

          {/* 右: 实时消息 */}
          <div className="flex min-h-[500px] flex-col rounded border border-gray-200 bg-white">
            <h2 className="border-b border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700">
              实时消息 ({logs.length})
            </h2>
            <div
              ref={scrollRef}
              className="flex-1 space-y-1 overflow-y-auto p-3 font-mono text-xs"
            >
              {logs.length === 0 && (
                <div className="py-8 text-center text-gray-400">等消息…</div>
              )}
              {logs.map((e, i) => (
                <div key={i} className={`rounded border px-2 py-1 ${bgFor(e.type)}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-gray-500">{fmtTime(e.ts)}</span>
                    <span className={`rounded px-1 text-[10px] font-bold ${
                      e.direction === 'send' ? 'bg-blue-200 text-blue-900'
                        : e.direction === 'recv' ? 'bg-green-200 text-green-900'
                        : 'bg-gray-300 text-gray-800'
                    }`}>
                      {e.direction}
                    </span>
                    <span className="font-semibold">{e.type}</span>
                  </div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-gray-800">
                    {typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
