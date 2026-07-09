'use client';

// UI client — 通过 UI 后端代理 (/api/admin/agent-test-chat) 调 Agent 的
// /api/admin/test-chat。直接调 Agent URL 也可以, 但走 UI 路由有 admin cookie
// 鉴权 + 错误统一处理。

import { useState } from 'react';

interface ChatResult {
  success: boolean;
  text?: string;
  model?: string;
  baseURL?: string;
  input_tokens?: number;
  output_tokens?: number;
  durationMs?: number;
  error?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export function TestChatClient() {
  const [prompt, setPrompt] = useState('用一句话介绍这个业务数据库');
  const [result, setResult] = useState<ChatResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/agent-test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, maxTokens: 256 }),
      });
      const data: ChatResult = await res.json();
      setResult(data);
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

  async function pingConnection() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/test-connection', {
        method: 'POST',
      });
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
          rows={3}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="输入一段 prompt 测试, Agent 会按当前 model 响应"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={send}
            disabled={loading || !prompt.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {loading ? '调用中...' : 'Send Chat'}
          </button>
          <button
            onClick={pingConnection}
            disabled={loading}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:bg-gray-100"
          >
            {loading ? '...' : 'Test Connection (ping)'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`rounded border p-4 text-sm ${result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="mb-2 font-medium">
            {result.success ? '✅ Success' : '❌ Failed'}
            {result.error && <span className="ml-2 text-xs">({result.error})</span>}
          </div>
          {result.text && (
            <pre className="whitespace-pre-wrap rounded bg-white p-3 text-gray-800">
              {result.text}
            </pre>
          )}
          {result.message && !result.text && (
            <div className="text-gray-700">{result.message}</div>
          )}
          {result.success && (
            <div className="mt-2 space-y-0.5 text-xs text-gray-500">
              {result.model && <div>model: <code>{result.model}</code></div>}
              {result.baseURL && <div>baseURL: <code>{result.baseURL}</code></div>}
              {result.input_tokens !== undefined && (
                <div>input_tokens: {result.input_tokens}, output_tokens: {result.output_tokens}</div>
              )}
              {result.durationMs !== undefined && <div>耗时: {result.durationMs}ms</div>}
            </div>
          )}
          {result.details && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-500">详情</summary>
              <pre className="mt-1 text-xs text-gray-600">{JSON.stringify(result.details, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
