'use client';

import { useEffect, useState } from 'react';

interface ScheduleRow {
  id: number;
  task_name: string;
  enabled: boolean;
  cron_expr: string;
  brands_filter: string | null;
  description: string | null;
  updated_at: string;
}

interface RunRow {
  id: number;
  task_name: string;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  error_message: string | null;
  new_notifications: number | null;
  trigger_source: string | null;
}

const PRESETS: Array<{ label: string; expr: string }> = [
  { label: '每日 09:00', expr: '0 9 * * *' },
  { label: '每日 09:30', expr: '30 9 * * *' },
  { label: '每月 6 日 06:00', expr: '0 6 6 * *' },
  { label: '自定义', expr: '' },
];

const BRANDS = ['tamkoko', 'gelatomiiix', 'bonjur'] as const;

const TASK_DESC: Record<string, string> = {
  data_stale: '每日检查企迈 T-1 + 银行流水 5 日前',
  unmatched_txn: '每日检查未配条目',
  dup_rule: '每日检查重复匹配规则',
  monthly_report: '每月 6 日生成上月月报',
};

export default function NotificationsConfigPage() {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');

  const load = async () => {
    const [s, r] = await Promise.all([
      fetch('/api/admin/notifications/schedule', { cache: 'no-store' }),
      fetch('/api/admin/notifications/schedule/runs', { cache: 'no-store' }),
    ]);
    if (s.ok) setRows((await s.json()).items);
    if (r.ok) setRuns((await r.json()).items);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (row: ScheduleRow) => {
    setSavingId(row.id);
    setStatus('保存中…');
    try {
      const res = await fetch('/api/admin/notifications/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            task_name: row.task_name,
            enabled: row.enabled,
            cron_expr: row.cron_expr,
            brands_filter: row.brands_filter,
          }],
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        setStatus(`保存失败: ${e.error}`);
        return;
      }
      setStatus('保存成功,正在重载调度…');
      const reload = await fetch('/api/admin/notifications/schedule/reload', { method: 'POST' });
      setStatus(reload.ok ? '已生效' : '已保存但重载失败,daemon 可能未运行');
      await load();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">通知调度配置</h1>
      {status && <div className="mb-4 p-2 bg-blue-50 text-blue-800 rounded text-sm">{status}</div>}
      <table className="w-full border-collapse mb-8">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">任务</th>
            <th className="border p-2 text-left">启用</th>
            <th className="border p-2 text-left">cron 表达式</th>
            <th className="border p-2 text-left">品牌过滤</th>
            <th className="border p-2 text-left">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="border p-2">
                <div className="font-medium">{row.task_name}</div>
                <div className="text-xs text-gray-500">{TASK_DESC[row.task_name]}</div>
              </td>
              <td className="border p-2 text-center">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => setRows((p) => p.map((r) => r.id === row.id ? { ...r, enabled: e.target.checked } : r))}
                />
              </td>
              <td className="border p-2">
                <input
                  className="border rounded px-2 py-1 w-32 font-mono text-sm"
                  value={row.cron_expr}
                  onChange={(e) => setRows((p) => p.map((r) => r.id === row.id ? { ...r, cron_expr: e.target.value } : r))}
                />
                <select
                  className="ml-2 border rounded px-1 py-1 text-sm"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setRows((p) => p.map((r) => r.id === row.id ? { ...r, cron_expr: v } : r));
                  }}
                  value=""
                >
                  <option value="">预设…</option>
                  {PRESETS.map((p) => (
                    <option key={p.expr} value={p.expr}>{p.label}</option>
                  ))}
                </select>
              </td>
              <td className="border p-2">
                <div className="flex flex-wrap gap-2">
                  {BRANDS.map((b) => {
                    const list = (row.brands_filter || '').split(',').filter(Boolean);
                    const checked = list.length === 0 || list.includes(b);
                    return (
                      <label key={b} className="text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const cur = new Set((row.brands_filter || '').split(',').filter(Boolean));
                            if (e.target.checked) cur.add(b);
                            else cur.delete(b);
                            const next = cur.size === BRANDS.length ? null : Array.from(cur).join(',');
                            setRows((p) => p.map((r) => r.id === row.id ? { ...r, brands_filter: next } : r));
                          }}
                        /> {b}
                      </label>
                    );
                  })}
                </div>
              </td>
              <td className="border p-2">
                <button
                  onClick={() => save(row)}
                  disabled={savingId === row.id}
                  className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                >
                  {savingId === row.id ? '保存中' : '保存'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="text-xl font-semibold mb-3">最近 10 次执行</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">任务</th>
            <th className="border p-2 text-left">开始</th>
            <th className="border p-2 text-left">结束</th>
            <th className="border p-2 text-left">状态</th>
            <th className="border p-2 text-left">新通知</th>
            <th className="border p-2 text-left">触发</th>
          </tr>
        </thead>
        <tbody>
          {runs.slice(0, 10).map((r) => (
            <tr key={r.id}>
              <td className="border p-2">{r.task_name}</td>
              <td className="border p-2">{r.started_at ? new Date(r.started_at).toLocaleString('zh-CN') : '-'}</td>
              <td className="border p-2">{r.finished_at ? new Date(r.finished_at).toLocaleString('zh-CN') : '-'}</td>
              <td className="border p-2">{r.status || '-'}</td>
              <td className="border p-2">{r.new_notifications ?? '-'}</td>
              <td className="border p-2">{r.trigger_source || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
