'use client';
import { useState } from 'react';
import type { AgentConfigParams, ThinkingLevel } from '@/lib/chat/agent-config-store';

interface Props {
  initial: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKeyMasked: string | null;
    model: string;
    jwksUrl: string | null;
    mcpBackends?: Array<{ name: string; url: string; transport?: string; headers?: Record<string, string>; timeoutMs?: number }>;
  };
  defaultParams: AgentConfigParams;
  onSave: (data: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKey: string;
    model: string;
    jwksUrl: string | null;
    mcpBackends?: Array<{ name: string; url: string; transport?: string; headers?: Record<string, string>; timeoutMs?: number }>;
  }) => Promise<void>;
  onReset: () => Promise<void>;
}

const PARAM_META: Array<{ key: keyof AgentConfigParams; label: string; min: number; max: number; step: number; help: string }> = [
  { key: 'maxTokens',            label: 'max_tokens (Anthropic)', min: 256, max: 16384, step: 256,  help: '单次响应的最大 token 数' },
  { key: 'temperature',          label: 'temperature',              min: 0,   max: 1,     step: 0.1,  help: '0=精确, 1=发散' },
  { key: 'topP',                 label: 'top_p (留空=用默认)',       min: 0,   max: 1,     step: 0.1,  help: '可选。nucleus sampling 阈值' },
  { key: 'maxToolChainDepth',    label: '工具调用深度',              min: 1,   max: 20,    step: 1,    help: '单会话最多连续调几次 MCP 工具' },
  { key: 'rateLimitMaxPerMinute',label: '60s 内最多消息数',          min: 1,   max: 100,   step: 1,    help: '限流阈值' },
  { key: 'tokenSoftLimit',       label: 'Token 软限 (compact 触发)', min: 10000, max: 200000, step: 5000, help: '超过则切到 compact prompt' },
  { key: 'tokenHardLimit',       label: 'Token 硬限 (报错)',          min: 50000, max: 500000, step: 10000, help: '超过则终止会话' },
  { key: 'mcpRetryMaxAttempts',  label: 'MCP 重试次数 (5xx)',       min: 1,   max: 5,     step: 1,    help: '最大重试次数 (含首次)' },
];

const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string; help: string }> = [
  { value: 'off',    label: '关闭',      help: '不启用 thinking,响应最快' },
  { value: 'low',    label: '低 (1K)',   help: '轻量思考,简单查询' },
  { value: 'medium', label: '中 (8K)',   help: '标准思考,适合数据查询' },
  { value: 'high',   label: '高 (16K)',  help: '深度思考,复杂分析。需 max_tokens ≥ 16385 (Anthropic 要求 budget_tokens < max_tokens)' },
];

export function AgentConfigEditor({ initial, defaultParams, onSave, onReset }: Props) {
  const [agentMd, setAgentMd] = useState(initial.agentMd);
  const [params, setParams] = useState<AgentConfigParams>(initial.params);
  const [baseURL, setBaseURL] = useState(initial.baseURL ?? '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initial.model);
  const [jwksUrl, setJwksUrl] = useState(initial.jwksUrl ?? '');
  const [mcpBackendsJson, setMcpBackendsJson] = useState(
    JSON.stringify(initial.mcpBackends ?? [], null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

  const dirty = agentMd !== initial.agentMd
    || (Object.keys(params) as Array<keyof AgentConfigParams>).some(k => params[k] !== initial.params[k])
    || baseURL !== (initial.baseURL ?? '')
    || apiKey !== ''
    || model !== initial.model
    || jwksUrl !== (initial.jwksUrl ?? '');

  function updateParam<K extends keyof AgentConfigParams>(k: K, v: number | string | null) {
    setParams(p => ({ ...p, [k]: v }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      // 解析 mcpBackends JSON
      let parsedBackends: Array<{ name: string; url: string; transport?: string; headers?: Record<string, string>; timeoutMs?: number }> | undefined;
      try {
        const val = JSON.parse(mcpBackendsJson);
        if (Array.isArray(val)) parsedBackends = val as any;
      } catch { /* keep undefined — don't send backends if JSON invalid */ }

      await onSave({
        agentMd,
        params,
        baseURL: baseURL.trim() || null,
        apiKey,
        model: model.trim() || 'claude-opus-4-8',
        jwksUrl: jwksUrl.trim() || null,
        mcpBackends: parsedBackends,
      });
      setMessage('✅ 已保存。下一个请求即生效。');
      setApiKey('');  // clear after save
    } catch (e) {
      setMessage('❌ 保存失败：' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('确定重置为默认值？')) return;
    setSaving(true);
    setMessage(null);
    try {
      await onReset();
      setMessage('✅ 已重置。');
    } catch (e) {
      setMessage('❌ 重置失败：' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** 轮询 agent 是否就绪（检查 agent.reachable），最多等 45 秒 */
  async function waitForAgentReady(maxWaitMs = 45000): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500))
      try {
        const res = await fetch('/api/admin/agent-config')
        if (res.ok) {
          const data = await res.json()
          if (data?.agent?.reachable && data?.agent?.source === 'db') {
            return true
          }
        }
      } catch { /* agent not reachable yet */ }
      setRestartMessage(`⏳ Agent 重启中... ${Math.round((deadline - Date.now()) / 1000)}s 后超时`)
    }
    return false
  }

  async function handleRestart() {
    if (!confirm('确定重启 Agent？重启期间服务暂时不可用（约 5-10 秒）。')) return;
    setRestarting(true);
    setRestartMessage(null);
    try {
      const r = await fetch('/api/admin/restart-agent', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRestartMessage('✅ Agent 正在重启...');

      const ready = await waitForAgentReady()
      if (ready) {
        setRestartMessage('✅ Agent 已就绪，配置完整。刷新页面...');
        setTimeout(() => window.location.reload(), 500)
      } else {
        setRestartMessage('⚠️ Agent 超时未就绪 — 请手动刷新页面确认状态');
      }
    } catch (e) {
      setRestartMessage('❌ 重启失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRestarting(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch('/api/admin/test-connection', { method: 'POST' });
      const data = await r.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ success: false, error: 'fetch_failed', message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <label className="block text-sm font-semibold text-gray-700">agent.md 内容</label>
        <p className="mt-1 text-xs text-gray-500">会被拼到 system prompt 的通用规则之前。下一个请求即生效。</p>
        <textarea
          value={agentMd}
          onChange={e => setAgentMd(e.target.value)}
          rows={20}
          className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
        />
        <div className="mt-1 text-right text-xs text-gray-500">{agentMd.length} 字符</div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">调试参数</h3>
        <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
          {PARAM_META.map(m => (
            <div key={m.key}>
              <label className="block text-xs text-gray-600">{m.label}</label>
              <input
                type="number"
                min={m.min}
                max={m.max}
                step={m.step}
                value={params[m.key] == null ? '' : String(params[m.key])}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '' && m.key === 'topP') {
                    updateParam(m.key, null);
                  } else {
                    const n = Number(v);
                    if (!Number.isNaN(n)) updateParam(m.key, n);
                  }
                }}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <p className="mt-1 text-[10px] text-gray-400">{m.help} (默认: {String(defaultParams[m.key])})</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">Thinking 等级</h3>
        <p className="mt-1 text-xs text-gray-500">
          启用 Anthropic 扩展思考 (extended thinking)。模型在回答前会先花 budget_tokens 推理,
          文字以折叠块形式出现在 chat 里。
        </p>
        <div className="mt-2 max-w-md">
          <label htmlFor="thinking-level" className="block text-xs text-gray-600">等级</label>
          <select
            id="thinking-level"
            value={params.thinkingLevel}
            onChange={e => updateParam('thinkingLevel', e.target.value as ThinkingLevel)}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            {THINKING_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-gray-400">
            {THINKING_OPTIONS.find(o => o.value === params.thinkingLevel)?.help}
            {' '}(默认: {String(defaultParams.thinkingLevel)})
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">API 配置</h3>
        <p className="mt-1 text-xs text-gray-500">
          Anthropic API 连接信息。Base URL / API Key 留空 = 保留当前值。改 Model 后下一个请求生效。
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs text-gray-600">JWKS URL</label>
            <input
              type="text"
              value={jwksUrl}
              onChange={e => setJwksUrl(e.target.value)}
              placeholder="http://192.168.5.2:6100/api/auth/jwks"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              Portal JWKS 端点,用于 WS/HTTP JWT 验签。留空 = 用 AGENT_JWKS_URL env。
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-600">
              Base URL <span className="text-gray-400">(留空 = 用 .env 的 ANTHROPIC_BASE_URL)</span>
            </label>
            <input
              type="text"
              value={baseURL}
              onChange={e => setBaseURL(e.target.value)}
              placeholder="https://your-anthropic-compatible-proxy.example.com"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600">
              API Key{' '}
              {initial.apiKeyMasked && (
                <span className="text-gray-400">(当前: {initial.apiKeyMasked})</span>
              )}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-...  (留空 = 保留当前值)"
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey(s => !s)}
                className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                title={showKey ? '隐藏' : '显示明文'}
                aria-label="toggle api key visibility"
              >
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-gray-400">
              提交后 AES-256-GCM 加密存到 DB。再次留空提交 = 保留当前值；想清除需填空白并保存（v1 简化：留空=保留；要清空请手动编辑 DB 或用"重置默认"）。
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-600">Model</label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="claude-opus-4-8"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          重置默认
        </button>
        <button
          onClick={handleTestConnection}
          disabled={testing || saving}
          className="rounded border border-blue-300 px-4 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        <button
          onClick={handleRestart}
          disabled={restarting}
          className="rounded border border-orange-300 px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 disabled:opacity-50"
        >
          {restarting ? '重启中…' : '重启 Agent'}
        </button>
        {message && <span className="text-sm text-gray-700">{message}</span>}
        {restartMessage && <span className="text-sm text-orange-700">{restartMessage}</span>}
      </div>
      {testResult && (
        <div className={`mt-3 rounded p-3 text-sm ${testResult.success ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
          <div className="font-semibold">
            {testResult.success ? '✅' : '❌'} {testResult.message}
          </div>
          <pre className="mt-1 whitespace-pre-wrap break-all text-xs">
{JSON.stringify(testResult.details ?? testResult.error, null, 2)}
          </pre>
        </div>
      )}

      {/* System Prompt 预览已挪到下方 <AgentConfigPreview> 组件 (拉真实 46 工具) */}

      {/* 外部 MCP 后端 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700">外部 MCP 后端</h3>
        <p className="mt-1 text-xs text-gray-500">
          JSON 数组，每项可含 <code>name</code>, <code>url</code>, <code>transport</code> (<em>fetch</em>/<em>sse</em>),
          <code>headers</code>, <code>timeoutMs</code>。写入后需重启 Agent 生效。
        </p>
        <textarea
          value={mcpBackendsJson}
          onChange={e => setMcpBackendsJson(e.target.value)}
          rows={8}
          className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
          placeholder={`[
  { "name": "dailycheck", "url": "http://dailycheck:5100/api/mcp",
    "transport": "fetch", "headers": { "Authorization": "Bearer xyz" },
    "timeoutMs": 30000
  }
]`}
        />
        <p className="mt-1 text-[10px] text-gray-400">
          {initial.mcpBackends?.length ?? 0} 个后端已配置（从 DB 加载）
        </p>
      </div>
    </div>
  );
}
