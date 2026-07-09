'use client';

// Test Chat client — Phase 7 升级为支持全栈(含 tool)。
//   "Send Chat"  → 调 /api/admin/agent-test-chat (单 LLM 往返, 无 tool)
//   "Send Full"  → 调 /api/admin/agent-test-run (LLM + 工具循环, 不存 DB)
// 两个按钮用一个 prompt 框。

import { useState } from 'react';

interface ChatResult {
  success: boolean;
  text?: string;
  model?: string;
  baseURL?: string;
  input_tokens?: number;
  output_tokens?: number;
  durationMs?: number;
  steps?: Array<{
    phase: string;
    label: string;
    toolName?: string;
    ok?: boolean;
  }>;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    success: boolean;
    output: unknown;
    latencyMs?: number;
  }>;
  iterations?: number;
  error?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export function TestChatClient() {
  const [prompt, setPrompt] = useState(
    '查询蜜可诗 gelatomiiix 这个月销售总额, 用真实 SQL 工具',
  );
  const [result, setResult] = useState<ChatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'full' | 'plain'>('full');

  async function callAgent(path: string, body: object) {
    setLoading(true);
    setResult(null);
    // Client-level abort: 90s 全栈 (LLM + 工具循环); 30s simple (单 LLM)
    // 否则浏览器会一直 pending, 用户体验像"卡死"
    const ms = path.endsWith('test-run') ? 90_000 : 30_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data: ChatResult = await res.json();
      setResult(data);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setResult({
          success: false,
          error: 'client_timeout',
          message: `客户端在 ${ms / 1000}s 内未收到响应 (UI 端可能有请求堆积)`,
        });
      } else {
        setResult({
          success: false,
          error: 'fetch_failed',
          message: (e as Error).message,
        });
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  async function send() {
    if (mode === 'full') {
      return callAgent('/api/admin/agent-test-run', {
        prompt,
        maxTokens: 4096,
      });
    }
    return callAgent('/api/admin/agent-test-chat', {
      prompt,
      maxTokens: 4096,
    });
  }

  async function pingConnection() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/test-connection', { method: 'POST' });
      const data = await res.json();
      setResult({
        success: !!data.success,
        text: data.message ?? '(no message)',
        model: data.details?.model,
        baseURL: data.details?.baseURL,
        input_tokens: data.details?.input_tokens,
        output_tokens: data.details?.output_tokens,
        details: data.details,
        error: data.error,
        message: data.success ? undefined : data.message,
      });
    } catch (e) {
      setResult({
        success: false,
        error: 'fetch_failed',
        message: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm font-medium text-gray-700">prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="输入一段 prompt 测试"
        />
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs text-gray-600">
            <input
              type="radio"
              name="mode"
              checked={mode === 'full'}
              onChange={() => setMode('full')}
              className="mr-1"
            />
            Full (LLM + 工具)
          </label>
          <label className="text-xs text-gray-600">
            <input
              type="radio"
              name="mode"
              checked={mode === 'plain'}
              onChange={() => setMode('plain')}
              className="mr-1"
            />
            Simple (单 LLM 往返)
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={send}
            disabled={loading || !prompt.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {loading ? '调用中...' : mode === 'full' ? 'Send Full' : 'Send Chat'}
          </button>
          <button
            onClick={pingConnection}
            disabled={loading}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:bg-gray-100"
          >
            Test Connection (ping)
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`rounded border p-4 text-sm ${result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
        >
          <div className="mb-2 font-medium">
            {result.success ? '✅ Success' : '❌ Failed'}
            {result.iterations !== undefined && (
              <span className="ml-2 text-xs text-gray-500">
                (iter={result.iterations})
              </span>
            )}
            {result.error && (
              <span className="ml-2 text-xs">({result.error})</span>
            )}
          </div>
          {result.text && (
            <pre className="whitespace-pre-wrap rounded bg-white p-3 text-gray-800">
              {result.text}
            </pre>
          )}
          {result.message && !result.text && (
            <div className="text-gray-700">{result.message}</div>
          )}

          {/* 工具调用步骤 (仅 full 模式) */}
          {result.steps && result.steps.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-700">steps:</div>
              <ol className="space-y-1 text-xs text-gray-600">
                {result.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        s.ok === false
                          ? 'bg-red-400'
                          : s.phase === 'complete'
                            ? 'bg-green-400'
                            : 'bg-gray-400'
                      }`}
                    />
                    <span className="font-mono text-gray-500">
                      [{s.phase}]
                    </span>
                    <span>{s.label}</span>
                    {s.toolName && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">
                        {s.toolName}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 工具调用结果 */}
          {result.toolCalls && result.toolCalls.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-700">
                tool calls ({result.toolCalls.length}):
              </div>
              <div className="space-y-2 text-xs">
                {result.toolCalls.map((tc, i) => (
                  <details
                    key={i}
                    className="rounded border border-gray-200 bg-white p-2"
                  >
                    <summary className="cursor-pointer">
                      <span
                        className={
                          tc.success ? 'text-green-700' : 'text-red-700'
                        }
                      >
                        {tc.success ? '✓' : '✗'} {tc.name}
                      </span>
                      {tc.latencyMs !== undefined && (
                        <span className="ml-2 text-gray-400">
                          ({tc.latencyMs}ms)
                        </span>
                      )}
                    </summary>
                    <pre className="mt-1 overflow-auto text-[10px] text-gray-600">
                      {JSON.stringify(tc.input, null, 2)}
                    </pre>
                    <div className="mt-1 text-[10px] font-medium text-gray-500">
                      output:
                    </div>
                    <pre className="overflow-auto text-[10px] text-gray-600">
                      {typeof tc.output === 'string'
                        ? tc.output
                        : JSON.stringify(tc.output, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* token 用量 */}
          {result.success && (
            <div className="mt-2 space-y-0.5 text-xs text-gray-500">
              {result.model && <div>model: <code>{result.model}</code></div>}
              {result.baseURL && (
                <div>
                  baseURL: <code>{result.baseURL}</code>
                </div>
              )}
              {result.input_tokens !== undefined && (
                <div>
                  input_tokens: {result.input_tokens}, output_tokens:{' '}
                  {result.output_tokens}
                </div>
              )}
              {result.durationMs !== undefined && (
                <div>耗时: {result.durationMs}ms</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
