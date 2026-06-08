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

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return '自定义';
  const [min, hour, dom, mon, dow] = parts;

  // 每 X 分钟
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `每 ${min.slice(2)} 分钟`;
  }
  // 每分钟
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return '每分钟';
  }
  // 每 X 小时
  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    return `每 ${hour.slice(2)} 小时`;
  }
  // 每周 X day_of_week HH:MM
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && /^\d+$/.test(dow)) {
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `每周${days[Number(dow)] || dow} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  // 每月 X 日 HH:MM
  if (min !== '*' && hour !== '*' && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    return `每月 ${dom} 日 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  // 每年 X 月 X 日 HH:MM
  if (min !== '*' && hour !== '*' && /^\d+$/.test(dom) && /^\d+$/.test(mon) && dow === '*') {
    return `每年 ${mon} 月 ${dom} 日 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  // 每日 HH:MM
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    return `每日 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  // 每小时整点
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return '每小时整点';
  }
  return '自定义';
}

function fmtTs(s: string | null): string {
  if (!s) return '-';
  return new Date(s).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function statusClasses(s: string | null): string {
  switch (s) {
    case 'success':
      return 'bg-emerald-100 text-emerald-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'running':
      return 'bg-amber-100 text-amber-700';
    case 'skipped':
      return 'bg-zinc-100 text-zinc-600';
    default:
      return 'bg-zinc-100 text-zinc-600';
  }
}

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
          items: [
            {
              task_name: row.task_name,
              enabled: row.enabled,
              cron_expr: row.cron_expr,
              brands_filter: row.brands_filter,
            },
          ],
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        setStatus(`保存失败: ${e.error}`);
        return;
      }
      setStatus('已保存,正在重载…');
      const reload = await fetch('/api/admin/notifications/schedule/reload', { method: 'POST' });
      setStatus(reload.ok ? '已生效' : '已保存但重载失败,daemon 可能未运行');
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const updateRow = (id: number, patch: Partial<ScheduleRow>) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const bannerClass = (() => {
    if (!status) return '';
    if (status.includes('失败')) return 'bg-red-50 border-red-200 text-red-700';
    if (status.includes('已生效') || status.includes('成功')) return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    return 'bg-zinc-50 border-zinc-200 text-zinc-700';
  })();

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-zinc-900">通知调度配置</h1>
        <p className="text-sm text-zinc-500 mt-1">
          4 个 sweep 任务的 cron 表达式与品牌过滤。保存后自动重载。
        </p>
      </header>

      {status && (
        <div className={`mb-6 border rounded-md p-3 text-sm ${bannerClass}`}>{status}</div>
      )}

      <div className="border border-zinc-200 rounded-md mb-10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <th className="py-2 px-3 text-left">任务</th>
              <th className="py-2 px-3 text-left w-16">启用</th>
              <th className="py-2 px-3 text-left">cron 表达式</th>
              <th className="py-2 px-3 text-left">品牌过滤</th>
              <th className="py-2 px-3 text-left w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const brandList = (row.brands_filter || '').split(',').filter(Boolean);
              const severityBorder = row.enabled ? 'border-l-emerald-600' : 'border-l-zinc-300';
              return (
                <tr
                  key={row.id}
                  className={`border-t border-zinc-100 border-l-[3px] ${severityBorder}`}
                >
                  <td className="py-3 px-3 align-top">
                    <div className="font-mono font-medium text-zinc-900 text-sm">{row.task_name}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">{TASK_DESC[row.task_name]}</div>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) => updateRow(row.id, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600 accent-emerald-600"
                    />
                  </td>
                  <td className="py-3 px-3 align-top">
                    <div className="flex items-center">
                      <input
                        type="text"
                        className="w-44 font-mono text-sm border border-zinc-300 rounded-sm px-2 py-1 focus:outline-none focus:border-zinc-900"
                        value={row.cron_expr}
                        onChange={(e) => updateRow(row.id, { cron_expr: e.target.value })}
                      />
                      <select
                        className="ml-2 text-xs border border-zinc-300 rounded-sm px-1 py-1 bg-white focus:outline-none focus:border-zinc-900"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) updateRow(row.id, { cron_expr: v });
                          e.currentTarget.value = '';
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>预设</option>
                        {PRESETS.map((p) => (
                          <option key={p.label} value={p.expr}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1.5 font-mono">
                      → {describeCron(row.cron_expr) || '(空)'}
                    </div>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <div className="flex items-center gap-4 text-xs">
                      {BRANDS.map((b) => {
                        const checked = brandList.length === 0 || brandList.includes(b);
                        return (
                          <label key={b} className="inline-flex items-center gap-1.5 text-zinc-700 font-mono">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const cur = new Set(brandList);
                                if (e.target.checked) {
                                  cur.add(b);
                                } else {
                                  cur.delete(b);
                                }
                                const next = cur.size === 0 || cur.size === BRANDS.length
                                  ? null
                                  : Array.from(cur).sort().join(',');
                                updateRow(row.id, { brands_filter: next });
                              }}
                              className="h-3.5 w-3.5 rounded border-zinc-300 accent-emerald-600"
                            />
                            {b}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <button
                      onClick={() => save(row)}
                      disabled={savingId === row.id}
                      className="text-sm font-medium bg-zinc-900 text-white px-3 py-1.5 rounded-sm hover:bg-zinc-700 disabled:opacity-40"
                    >
                      {savingId === row.id ? '保存中' : '保存'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 px-3 text-center text-xs text-zinc-400">
                  暂无调度任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <header className="mb-4">
        <h2 className="font-display text-xl text-zinc-900">最近 10 次执行</h2>
      </header>

      <div className="border border-zinc-200 rounded-md overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-zinc-50">
              <th className="py-2 px-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">任务</th>
              <th className="py-2 px-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">开始</th>
              <th className="py-2 px-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">结束</th>
              <th className="py-2 px-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">状态</th>
              <th className="py-2 px-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">新通知</th>
              <th className="py-2 px-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">触发</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {runs.slice(0, 10).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-xs text-zinc-700 font-mono">{r.task_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500">{fmtTs(r.started_at)}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500">{fmtTs(r.finished_at)}</td>
                <td className="px-3 py-2 text-xs">
                  <span className={`inline-block px-2 py-0.5 rounded-sm text-[11px] font-medium ${statusClasses(r.status)}`}>
                    {r.status || '-'}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-700">{r.new_notifications ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500">{r.trigger_source || '-'}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-zinc-400">
                  暂无执行记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
