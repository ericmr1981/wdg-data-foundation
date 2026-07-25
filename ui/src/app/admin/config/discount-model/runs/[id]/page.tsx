'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

type Run = {
  run_id: string;
  version: string;
  pipeline: string;
  status: string;
  is_active: boolean;
  cancel_requested: boolean;
  fallback_to: string | null;
  data_range_start: string | null;
  data_range_end: string | null;
  warnings: string[];
  started_at: string;
  finished_at: string | null;
  store_code: string;
};

type Step = {
  step_id: number;
  step_name: string;
  step_order: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
  rows_out: number | null;
  error_message: string | null;
  detail: any;
};

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0, percent: 0, current: null as string | null });
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/discount-model/runs/${id}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setRun(j.run);
        setSteps(j.steps);
        setProgress(j.progress);
      }
    } catch {/* ignore */}
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const cancel = async () => {
    if (!confirm('确认取消？脚本将在 5–10 秒内优雅停止。')) return;
    setCancelling(true);
    try {
      const res = await fetch('/api/admin/discount-model/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: id }),
      });
      const j = await res.json();
      if (!j.ok) alert(`取消失败：${j.error || res.status}`);
      refresh();
    } finally {
      setCancelling(false);
    }
  };

  const copyError = async () => {
    const text = steps
      .filter(s => s.error_message)
      .map(s => `[${s.step_name}] ${s.error_message}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制报错日志');
    } catch {
      alert(text);
    }
  };

  if (!run) {
    return <div className="p-4 text-sm text-gray-500">加载中…</div>;
  }

  const isRunning = run.status === 'running';

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/config/discount-model" className="text-sm text-blue-700 underline">← 返回运行列表</Link>
      </div>

      <section className="bg-white border rounded p-4">
        <h1 className="text-lg font-semibold">Run {run.version}</h1>
        <div className="text-sm text-gray-600 mt-1 space-y-1">
          <div>run_id：<code className="text-xs">{run.run_id}</code></div>
          <div>pipeline：{run.pipeline}　store：{run.store_code}</div>
          <div>状态：
            <span className={
              'ml-1 inline-block px-2 rounded text-xs text-white ' +
              (run.status === 'success' ? 'bg-green-600'
                : run.status === 'failed' ? 'bg-red-600'
                : run.status === 'cancelled' ? 'bg-gray-500'
                : 'bg-blue-600')
            }>{run.status}</span>
            {run.is_active && <span className="ml-2 text-xs text-amber-700">active</span>}
            {run.cancel_requested && <span className="ml-2 text-xs text-gray-500">cancel_requested</span>}
          </div>
          <div>数据区间：{run.data_range_start} ~ {run.data_range_end}</div>
          <div>开始：{run.started_at}　结束：{run.finished_at ?? '—'}</div>
          {run.fallback_to && <div className="text-amber-700">fallback_to：{run.fallback_to}</div>}
          {run.warnings && run.warnings.length > 0 && (
            <div className="text-amber-700">
              警告：
              <ul className="list-disc ml-5">
                {run.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>

        {isRunning && !run.cancel_requested && (
          <button
            onClick={cancel}
            disabled={cancelling}
            className="mt-3 border rounded px-3 py-1 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? '取消中…' : '取消运行'}
          </button>
        )}
      </section>

      {/* 进度条 */}
      <section className="bg-white border rounded p-4">
        <h2 className="font-medium mb-2">进度：{progress.completed}/{progress.total}（{progress.percent}%）</h2>
        <div className="w-full bg-gray-200 rounded h-3 overflow-hidden">
          <div className="bg-blue-600 h-3" style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="text-sm text-gray-600 mt-2">当前步骤：{progress.current ?? '—'}</div>
      </section>

      {/* 步骤列表 */}
      <section className="bg-white border rounded p-4">
        <h2 className="font-medium mb-3">步骤</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="py-2">#</th>
              <th>步骤</th>
              <th>状态</th>
              <th>耗时(s)</th>
              <th>输出行数</th>
              <th>开始</th>
              <th>结束</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(s => (
              <tr key={s.step_id} className="border-b align-top">
                <td className="py-1">{s.step_order}</td>
                <td>
                  <div>{s.step_name}</div>
                  {s.error_message && (
                    <pre className="text-[11px] text-red-700 mt-1 whitespace-pre-wrap">{s.error_message}</pre>
                  )}
                </td>
                <td>
                  <span className={
                    'inline-block px-2 rounded text-xs text-white ' +
                    (s.status === 'success' ? 'bg-green-600'
                      : s.status === 'failed' ? 'bg-red-600'
                      : s.status === 'cancelled' ? 'bg-gray-500'
                      : s.status === 'running' ? 'bg-blue-600 animate-pulse'
                      : 'bg-gray-400')
                  }>{s.status}</span>
                </td>
                <td>{s.duration_sec ?? '—'}</td>
                <td>{s.rows_out ?? '—'}</td>
                <td className="text-xs">{s.started_at}</td>
                <td className="text-xs">{s.finished_at ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {steps.some(s => s.error_message) && (
          <button
            onClick={copyError}
            className="mt-3 text-xs border rounded px-2 py-1 bg-white hover:bg-gray-50"
          >
            复制所有报错
          </button>
        )}
      </section>
    </div>
  );
}