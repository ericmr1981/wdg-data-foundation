'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';

type Run = {
  run_id: string;
  version: string;
  pipeline: string;
  status: string;
  is_active: boolean;
  cancel_requested: boolean;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
  data_range_start: string | null;
  data_range_end: string | null;
  store_code: string;
};

type Active = {
  run_id: string;
  version: string;
  status: string;
  is_active: boolean;
  fallback_to: string | null;
  data_range_start: string | null;
  data_range_end: string | null;
  warnings: string[];
  finished_at: string | null;
  store_code: string;
} | null;

const PIPELINES: Array<{ key: 'full' | 'prepare' | 'train' | 'publish'; label: string }> = [
  { key: 'full', label: '一键全流程' },
  { key: 'prepare', label: '数据更新' },
  { key: 'train', label: '重训模型' },
  { key: 'publish', label: '预测发布' },
];

export default function DiscountModelConfigPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [active, setActive] = useState<Active>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/discount-model/runs?limit=20', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setRuns(j.runs || []);
        setActive(j.active || null);
      }
    } catch {/* ignore */}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, refreshTick]);

  const start = async (pipeline: 'full' | 'prepare' | 'train' | 'publish') => {
    setBusy(pipeline);
    try {
      const res = await fetch('/api/admin/discount-model/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline }),
      });
      const j = await res.json();
      if (j.run_id) {
        setRefreshTick(t => t + 1);
        // jump to run detail page
        window.location.href = `/admin/config/discount-model/runs/${j.run_id}`;
        return;
      }
      alert(`启动失败：${j.error || res.status}`);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (run_id: string) => {
    if (!confirm(`确认取消 run ${run_id}？脚本将在 5–10 秒内优雅停止。`)) return;
    const res = await fetch('/api/admin/discount-model/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id }),
    });
    const j = await res.json();
    if (!j.ok) alert(`取消失败：${j.error || res.status}`);
    setRefreshTick(t => t + 1);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Admin / 配置 / 折扣率分析模型</h1>

      {/* 当前生效版本 */}
      <section className="bg-white border rounded p-4">
        <h2 className="font-medium mb-2">当前生效版本</h2>
        {active ? (
          <div className="text-sm space-y-1">
            <div>version：<code>{active.version}</code>（store={active.store_code}）</div>
            <div>数据区间：{active.data_range_start} ~ {active.data_range_end}</div>
            <div>状态：
              <span className="ml-1 inline-block px-2 rounded text-white text-xs bg-green-600">
                {active.status}
              </span>
            </div>
            <div>完成时间：{active.finished_at || '—'}</div>
            {active.fallback_to && (
              <div className="text-amber-700">注意：实际来自上一版 fallback_to={active.fallback_to}</div>
            )}
            {active.warnings && active.warnings.length > 0 && (
              <div className="text-amber-700">
                警告：
                <ul className="list-disc ml-5">
                  {active.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500">暂无生效版本。先点下方按钮发起首次全流程。</div>
        )}
      </section>

      {/* 操作按钮 */}
      <section className="bg-white border rounded p-4">
        <h2 className="font-medium mb-3">操作</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {PIPELINES.map(p => (
            <button
              key={p.key}
              disabled={busy !== null}
              onClick={() => start(p.key)}
              className="border rounded px-3 py-2 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === p.key ? '启动中…' : p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          一键全流程 = 数据更新 → 重训模型 → 预测发布；后三步单独运行时不切换 is_active。
        </p>
      </section>

      {/* 运行历史 */}
      <section className="bg-white border rounded p-4">
        <h2 className="font-medium mb-3">运行历史（最近 20 次）</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-2">version</th>
                <th>pipeline</th>
                <th>状态</th>
                <th>取消</th>
                <th>数据区间</th>
                <th>开始</th>
                <th>耗时(s)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.run_id} className="border-b">
                  <td className="py-2"><Link className="text-blue-700 underline" href={`/admin/config/discount-model/runs/${r.run_id}`}>{r.version}</Link></td>
                  <td>{r.pipeline}</td>
                  <td>
                    <span className={
                      'inline-block px-2 rounded text-xs text-white ' +
                      (r.status === 'success' ? 'bg-green-600'
                        : r.status === 'failed' ? 'bg-red-600'
                        : r.status === 'cancelled' ? 'bg-gray-500'
                        : 'bg-blue-600')
                    }>{r.status}</span>
                    {r.is_active && <span className="ml-1 text-xs text-amber-700">active</span>}
                  </td>
                  <td>{r.cancel_requested ? '已请求' : ''}</td>
                  <td>{r.data_range_start} ~ {r.data_range_end}</td>
                  <td>{r.started_at}</td>
                  <td>{r.duration_sec ?? '—'}</td>
                  <td>
                    {r.status === 'running' && !r.cancel_requested && (
                      <button
                        onClick={() => cancel(r.run_id)}
                        className="text-xs border rounded px-2 py-0.5 bg-white hover:bg-gray-50"
                      >
                        取消
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-gray-400">暂无运行</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}