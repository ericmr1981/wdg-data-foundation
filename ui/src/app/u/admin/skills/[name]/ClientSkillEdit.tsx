'use client';
// Client component for editing a single skill (full markdown raw).
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  name: string;
  initialDescription: string;
  initialTriggers: string[];
  initialRaw: string;
  initialDisabled: boolean;
}

export function ClientSkillEdit({ name, initialDescription, initialTriggers, initialRaw, initialDisabled }: Props) {
  const router = useRouter();
  const [raw, setRaw] = useState(initialRaw);
  const [description, setDescription] = useState(initialDescription);
  const [triggersText, setTriggersText] = useState(initialTriggers.join(', '));
  const [disabled, setDisabled] = useState(initialDisabled);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dirty = raw !== initialRaw || disabled !== initialDisabled;

  function rebuildRaw(): string {
    // 用最新的 description / triggers / disabled 替换 frontmatter, body 保留 raw 里的
    const fmEnd = raw.indexOf('---', 4);
    const body = fmEnd > 0 ? raw.slice(fmEnd + 3).replace(/^\n+/, '') : raw;
    const triggersYaml = triggersText
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => `  - "${t.replace(/"/g, '\\"')}"`)
      .join('\n');
    const disabledYaml = disabled ? 'disabled: true\n' : '';
    const newFm = `---\nname: ${name}\ndescription: |\n  ${description.replace(/\n/g, '\n  ')}\n${disabledYaml}triggers:\n${triggersYaml || '  []'}\n---\n\n`;
    return newFm + body;
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const body = rebuildRaw();
      const r = await fetch(`/api/admin/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRaw(body);
      setStatus('✅ Saved. 点 Reload 让 agent 重新加载.');
    } catch (e) {
      setStatus('❌ 保存失败: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    const r = await fetch('/api/admin/skills/reload', { method: 'POST' });
    const j = await r.json();
    if (!r.ok || !j.success) {
      setStatus('❌ Reload 失败: ' + (j.error ?? `HTTP ${r.status}`));
    } else {
      setStatus('✅ Reloaded. agent 已重新加载所有 skill.');
    }
  }

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setStatus('⚠️ 再点一次 Delete 确认删除. 删了就真没了.');
      return;
    }
    try {
      const r = await fetch(`/api/admin/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
      router.push('/u/admin/skills');
    } catch (e) {
      setStatus('❌ 删除失败: ' + (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-200 bg-white p-4">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700">Name (只读)</label>
            <input
              type="text"
              value={name}
              readOnly
              className="mt-1 w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm text-gray-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700">Triggers (逗号分隔)</label>
            <input
              type="text"
              value={triggersText}
              onChange={e => setTriggersText(e.target.value)}
              placeholder="e.g. 银行分类, 流水, in_amt"
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="disabled-toggle"
              type="checkbox"
              checked={disabled}
              onChange={e => setDisabled(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="disabled-toggle" className="text-xs text-gray-700 select-none">
              <span className="font-semibold">禁用此 skill</span>
              <span className="ml-2 text-gray-500">
                (.md 文件保留, 但 agent 不会加载, 不会注入到 LLM 的 skill 列表)
              </span>
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700">Raw markdown (含 frontmatter)</label>
        <p className="mt-1 text-[11px] text-gray-500">
          编辑上面的 description / triggers 会自动重写 frontmatter 并保留 body. 也可以直接改 raw.
        </p>
        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          rows={24}
          className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
        />
        <div className="mt-1 text-right text-xs text-gray-500">{raw.length} 字符</div>
      </div>

      {status && (
        <div className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          {status}
        </div>
      )}

      <div className="flex items-center gap-3 border-t pt-4">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : 'Save'}
        </button>
        <button
          onClick={handleReload}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Reload
        </button>
        <button
          onClick={() => router.push('/u/admin/skills')}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <div className="flex-1" />
        <button
          onClick={handleDelete}
          className={`rounded border px-4 py-2 text-sm ${confirming ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          {confirming ? '确认删除?' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
