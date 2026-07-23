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
    /**
     * 结构化 backend 列表(GET 返回,不含 Authorization)。
     * 运行时 token 通过 mcpBackendTokensMasked[name] = '已配置' | null 判断是否已配。 */
    mcpBackends?: Array<{ name: string; url: string; transport?: string; headers?: Record<string, string>; timeoutMs?: number; required?: boolean }>;
    mcpBackendTokensMasked?: Record<string, string | null>;
    mcpBackendTokensCount?: number;
  };
  defaultParams: AgentConfigParams;
  onSave: (data: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKey: string;
    model: string;
    jwksUrl: string | null;
    /** 结构化 backend 列表(已剥 Authorization) */
    mcpBackends?: Array<{ name: string; url: string; transport?: string; headers?: Record<string, string>; timeoutMs?: number; required?: boolean }>;
    /** raw Bearer tokens(只传非空项) */
    mcpBackendTokens?: Record<string, string>;
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

  // 结构化 backend 列表 — 每项独立表单
  const [mcpBackends, setMcpBackends] = useState<
    Array<{ name: string; url: string; transport: string; timeoutMs: number; required: boolean; headers: Record<string, string> }>
  >(
    (initial.mcpBackends ?? []).map(b => ({
      name: b.name,
      url: b.url,
      transport: b.transport ?? 'streamableHttp',
      timeoutMs: b.timeoutMs ?? 30000,
      required: b.required ?? false,
      headers: Object.fromEntries(
        Object.entries(b.headers ?? {}).filter(([k]) => k.toLowerCase() !== 'authorization'),
      ),
    })),
  );
  // raw token 编辑值 — 只在用户实际输入时存在,初始为空,Save 后清空
  const [mcpBackendTokens, setMcpBackendTokens] = useState<Record<string, string>>({});
  // mask 视图(GET 返回,只显示"已配置"或 null)
  const [tokenMask] = useState<Record<string, string | null>>(initial.mcpBackendTokensMasked ?? {});

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
    || jwksUrl !== (initial.jwksUrl ?? '')
    || JSON.stringify(mcpBackends) !== JSON.stringify(
      (initial.mcpBackends ?? []).map(b => ({
        name: b.name,
        url: b.url,
        transport: b.transport ?? 'streamableHttp',
        timeoutMs: b.timeoutMs ?? 30000,
        required: b.required ?? false,
        headers: Object.fromEntries(
          Object.entries(b.headers ?? {}).filter(([k]) => k.toLowerCase() !== 'authorization'),
        ),
      })),
    )
    || Object.values(mcpBackendTokens).some(v => v !== '');

  function updateParam<K extends keyof AgentConfigParams>(k: K, v: number | string | null) {
    setParams(p => ({ ...p, [k]: v }));
  }

  function addBackend() {
    setMcpBackends(prev => [...prev, {
      name: '',
      url: 'http://localhost:5100/api/mcp/',
      transport: 'streamableHttp',
      timeoutMs: 30000,
      required: false,
      headers: { 'Accept': 'application/json, text/event-stream' },
    }]);
  }

  function removeBackend(idx: number) {
    const target = mcpBackends[idx]
    setMcpBackends(prev => prev.filter((_, i) => i !== idx))
    if (target?.name) {
      setMcpBackendTokens(prev => {
        const next = { ...prev }
        delete next[target.name]
        return next
      })
    }
  }

  function updateBackend(idx: number, patch: Partial<{
    name: string; url: string; transport: string; timeoutMs: number; required: boolean; headers: Record<string, string>
  }>) {
    setMcpBackends(prev => prev.map((b, i) => i === idx ? { ...b, ...patch } : b))
  }

  function addHeader(idx: number) {
    setMcpBackends(prev => prev.map((b, i) => i === idx ? { ...b, headers: { ...b.headers, '': '' } } : b))
  }

  function removeHeader(idx: number, key: string) {
    setMcpBackends(prev => prev.map((b, i) => {
      if (i !== idx) return b
      const next = { ...b.headers }
      delete next[key]
      return { ...b, headers: next }
    }))
  }

  function updateHeaderName(idx: number, oldKey: string, newKey: string) {
    setMcpBackends(prev => prev.map((b, i) => {
      if (i !== idx) return b
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(b.headers)) {
        next[k === oldKey ? newKey : k] = v
      }
      return { ...b, headers: next }
    }))
  }

  function updateHeaderValue(idx: number, key: string, value: string) {
    setMcpBackends(prev => prev.map((b, i) => i === idx ? { ...b, headers: { ...b.headers, [key]: value } } : b))
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      // 校验:name 非空且唯一
      const names = mcpBackends.map(b => b.name.trim())
      if (names.some(n => !n)) {
        throw new Error('每个 backend 必须有非空 name')
      }
      if (new Set(names).size !== names.length) {
        throw new Error('backend name 必须唯一')
      }
      // 校验:headers 里不允许 Authorization
      for (const b of mcpBackends) {
        for (const k of Object.keys(b.headers)) {
          if (k.toLowerCase() === 'authorization') {
            throw new Error(`backend "${b.name}" headers.${k} 不允许直接编辑,请用下方 Token 框`)
          }
        }
      }

      // 收集非空 token
      const tokensToSubmit: Record<string, string> = {}
      for (const [name, raw] of Object.entries(mcpBackendTokens)) {
        if (raw.trim()) tokensToSubmit[name] = raw.trim()
      }

      await onSave({
        agentMd,
        params,
        baseURL: baseURL.trim() || null,
        apiKey,
        model: model.trim() || 'claude-opus-4-8',
        jwksUrl: jwksUrl.trim() || null,
        mcpBackends: mcpBackends.map(b => ({
          name: b.name.trim(),
          url: b.url.trim(),
          transport: b.transport,
          timeoutMs: b.timeoutMs,
          required: b.required,
          headers: b.headers,
        })),
        mcpBackendTokens: Object.keys(tokensToSubmit).length > 0 ? tokensToSubmit : undefined,
      });
      setMessage('✅ 已保存。token 已加密入库,需重启 Agent 生效新连接。');
      setApiKey('');
      setMcpBackendTokens({});
    } catch (e) {
      setMessage('❌ 保存失败:' + (e as Error).message);
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
      // 503: 后端明确分类的"agent 不可达 / 不健康" — 直接红字, 不进 90s 轮询
      if (r.status === 503) {
        const data = await r.json().catch(() => ({}));
        setRestartMessage('❌ ' + (data.message ?? 'Agent 不可达'));
        return;
      }
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
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-700">外部 MCP 后端</h3>
          <span className="text-xs text-gray-500">
            {initial.mcpBackends?.length ?? 0} 个已配置 ·
            {' '}{Object.values(tokenMask).filter(v => v === '已配置').length} 个 token 已加密入库
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Token 在 <a className="text-blue-600 underline" href="http://dailycheck:8080/admin/agent-tokens" target="_blank" rel="noopener noreferrer">DailyCheck UI</a> 创建,
          创建时 raw token 一次性显示。粘贴到下方对应 backend 的 Token 框,保存后 Agent 会用 <code>AGENT_CRED_ENCRYPTION_KEY</code> 加密入库。
          写入后需重启 Agent 生效新连接。
        </p>

        <div className="mt-3 space-y-4">
          {mcpBackends.map((b, idx) => (
            <div key={idx} className="rounded border border-gray-300 bg-white p-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col text-xs text-gray-600">
                  <span className="mb-1 font-medium">Name *</span>
                  <input
                    type="text"
                    value={b.name}
                    onChange={e => updateBackend(idx, { name: e.target.value })}
                    placeholder="DailyCheck"
                    className="rounded border border-gray-300 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col text-xs text-gray-600">
                  <span className="mb-1 font-medium">URL *</span>
                  <input
                    type="text"
                    value={b.url}
                    onChange={e => updateBackend(idx, { url: e.target.value })}
                    placeholder="http://dailycheck:5100/api/mcp/"
                    className="rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                  />
                </label>
                <label className="flex flex-col text-xs text-gray-600">
                  <span className="mb-1 font-medium">Transport</span>
                  <select
                    value={b.transport}
                    onChange={e => updateBackend(idx, { transport: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1"
                  >
                    <option value="fetch">fetch</option>
                    <option value="streamableHttp">streamableHttp</option>
                    <option value="sse">sse</option>
                  </select>
                </label>
                <label className="flex flex-col text-xs text-gray-600">
                  <span className="mb-1 font-medium">Timeout (ms)</span>
                  <input
                    type="number"
                    value={b.timeoutMs}
                    onChange={e => updateBackend(idx, { timeoutMs: Number(e.target.value) || 30000 })}
                    className="rounded border border-gray-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={b.required}
                    onChange={e => updateBackend(idx, { required: e.target.checked })}
                  />
                  <span>Required (启动阻塞,失败即报错)</span>
                </label>
              </div>

              {/* Token 字段 */}
              <div className="mt-3">
                <label className="flex flex-col text-xs text-gray-600">
                  <span className="mb-1 font-medium">
                    Token (Bearer,不含前缀)
                    {tokenMask[b.name] === '已配置' && (
                      <span className="ml-2 text-green-700">✓ 已配置(留空保留,新值覆盖)</span>
                    )}
                  </span>
                  <input
                    type="password"
                    value={mcpBackendTokens[b.name] ?? ''}
                    onChange={e => setMcpBackendTokens(prev => ({ ...prev, [b.name]: e.target.value }))}
                    placeholder={tokenMask[b.name] === '已配置'
                      ? '已配置 — 留空保留,粘贴新值覆盖'
                      : '在 DailyCheck UI 创建后粘贴 raw token'}
                    autoComplete="new-password"
                    className="rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                  />
                </label>
              </div>

              {/* Custom Headers(不含 Authorization) */}
              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-gray-600">Custom Headers</span>
                  <button
                    type="button"
                    onClick={() => addHeader(idx)}
                    className="text-xs text-blue-600 hover:underline"
                  >+ Add header</button>
                </div>
                {Object.entries(b.headers).map(([k, v]) => (
                  <div key={k} className="mb-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={k}
                      placeholder="Header-Name"
                      onChange={e => updateHeaderName(idx, k, e.target.value)}
                      className="w-1/3 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                    />
                    <input
                      type="text"
                      value={v}
                      placeholder="value"
                      onChange={e => updateHeaderValue(idx, k, e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeHeader(idx, k)}
                      className="text-xs text-red-600 hover:underline"
                    >×</button>
                  </div>
                ))}
                {Object.keys(b.headers).length === 0 && (
                  <p className="text-[10px] text-gray-400">无 header</p>
                )}
              </div>

              <div className="mt-3 text-right">
                <button
                  type="button"
                  onClick={() => removeBackend(idx)}
                  className="text-xs text-red-600 hover:underline"
                >Delete backend</button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addBackend}
            className="rounded border border-dashed border-gray-400 bg-gray-50 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >+ Add backend</button>
        </div>
      </div>
    </div>
  );
}
