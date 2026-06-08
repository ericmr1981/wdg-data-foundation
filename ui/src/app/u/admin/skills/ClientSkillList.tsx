'use client';
// Client component for the skills list table.
import { useState } from 'react';
import Link from 'next/link';

interface SkillSummary {
  name: string;
  description: string;
  triggers: string[];
  filename: string;
  size: number;
  modifiedAt: string;
}

interface Props {
  initialSkills: SkillSummary[];
  initialError: string | null;
}

export function ClientSkillList({ initialSkills, initialError }: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>(initialSkills);
  const [error, setError] = useState<string | null>(initialError);
  const [reloading, setReloading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<SkillSummary | null>(null);
  const [viewBody, setViewBody] = useState<string>('');
  const [viewLoading, setViewLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleReload() {
    setReloading(true);
    setStatus(null);
    try {
      const r = await fetch('/api/admin/skills/reload', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStatus('✅ Reloaded. 5 个 skill 已重新加载。');
    } catch (e) {
      setStatus('❌ Reload 失败: ' + (e as Error).message);
    } finally {
      setReloading(false);
    }
  }

  async function handleNew() {
    const name = window.prompt('新 skill 的 name (英文, kebab-case, 例: my-new-skill):');
    if (!name) return;
    if (!/^[a-z0-9-]+$/.test(name)) {
      alert('name 只能含小写字母、数字、连字符');
      return;
    }
    setCreating(true);
    setStatus(null);
    try {
      const r = await fetch('/api/admin/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStatus(`✅ Created ${name}. 跳转编辑页...`);
      window.location.href = `/u/admin/skills/${encodeURIComponent(name)}`;
    } catch (e) {
      setStatus('❌ 创建失败: ' + (e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleView(s: SkillSummary) {
    setViewing(s);
    setViewBody('');
    setViewLoading(true);
    try {
      const r = await fetch(`/api/admin/skills/${encodeURIComponent(s.name)}`);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
      setViewBody(j.raw ?? j.body ?? '');
    } catch (e) {
      setViewBody('加载失败: ' + (e as Error).message);
    } finally {
      setViewLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          共 {skills.length} 个 skill
          {error && <span className="ml-3 text-red-600">加载失败: {error}</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReload}
            disabled={reloading}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {reloading ? 'Reloading...' : 'Reload'}
          </button>
          <button
            onClick={handleNew}
            disabled={creating}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : '+ New Skill'}
          </button>
        </div>
      </div>

      {status && (
        <div className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          {status}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Triggers</th>
              <th className="px-4 py-2 text-right">Size</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {skills.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  暂无 skill
                </td>
              </tr>
            )}
            {skills.map(s => (
              <tr key={s.filename} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs text-gray-900">{s.name}</td>
                <td className="px-4 py-2 text-gray-700">
                  <span className="line-clamp-2">{s.description.split('\n')[0]}</span>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {s.triggers.length > 0 ? s.triggers.join(', ') : '—'}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-500">
                  {(s.size / 1024).toFixed(1)} KB
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleView(s)}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      View
                    </button>
                    <Link
                      href={`/u/admin/skills/${encodeURIComponent(s.name)}`}
                      className="rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                    >
                      Edit
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setViewing(null)}
        >
          <div
            className="max-h-[80vh] w-[min(900px,90vw)] overflow-y-auto rounded bg-white p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{viewing.name}</h2>
                <p className="text-xs text-gray-500">{viewing.filename}</p>
              </div>
              <button
                onClick={() => setViewing(null)}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
            {viewLoading ? (
              <p className="text-sm text-gray-500">加载中...</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800">
                {viewBody}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
