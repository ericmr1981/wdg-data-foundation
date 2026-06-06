'use client';
import { useState } from 'react';
import type { AgentConfigParams } from '@/lib/chat/agent-config-store';

interface Props {
  initial: { agentMd: string; params: AgentConfigParams };
  defaultParams: AgentConfigParams;
  onSave: (data: { agentMd: string; params: AgentConfigParams }) => Promise<void>;
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

export function AgentConfigEditor({ initial, defaultParams, onSave, onReset }: Props) {
  const [agentMd, setAgentMd] = useState(initial.agentMd);
  const [params, setParams] = useState<AgentConfigParams>(initial.params);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = agentMd !== initial.agentMd ||
    (Object.keys(params) as Array<keyof AgentConfigParams>).some(k => params[k] !== initial.params[k]);

  function updateParam<K extends keyof AgentConfigParams>(k: K, v: number | null) {
    setParams(p => ({ ...p, [k]: v }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ agentMd, params });
      setMessage('✅ 已保存。下个请求即生效。');
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
        {message && <span className="text-sm text-gray-700">{message}</span>}
      </div>
    </div>
  );
}
