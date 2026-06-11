'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationItem, NotificationType, Severity } from '@/lib/notification-types';

const TYPE_LABELS: Record<NotificationType, string> = {
  data_stale: '数据未更新',
  unmatched_txn: '未配条目',
  dup_rule: '重复匹配',
  monthly_report: '月报表',
};

const SEVERITY_BG: Record<Severity, string> = {
  error: 'bg-red-600',
  warn: 'bg-amber-500',
  info: 'bg-blue-600',
};

const TABS: Array<{ key: 'all' | NotificationType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'data_stale', label: '数据未更新' },
  { key: 'unmatched_txn', label: '未配条目' },
  { key: 'dup_rule', label: '重复匹配' },
  { key: 'monthly_report', label: '月报表' },
];

function formatTs(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [tab, setTab] = useState<'all' | NotificationType>('all');
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetch('/api/notifications', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items || []);
        setUnreadCount(d.unread_count || 0);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = tab === 'all' ? items : items.filter((x) => x.type === tab);

  const markRead = async (n: NotificationItem) => {
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
    }
    if (n.action_url) {
      if (n.action_url.startsWith('/api/')) {
        window.location.href = n.action_url;
      } else {
        router.push(n.action_url);
      }
    }
  };

  const dismiss = async (e: React.MouseEvent, n: NotificationItem) => {
    e.stopPropagation();
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.is_read) {
      setUnreadCount((c) => Math.max(0, c - 1));
      await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <h1
            className="text-3xl tracking-tight text-zinc-900"
            style={{ fontFamily: 'Fraunces, ui-serif, Georgia, serif' }}
          >
            站内通知
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            4 个 sweep 任务产生的提醒。全部 {TABS.length - 1} 类已分类,可按类型筛选。
          </p>
        </div>
        {unreadCount > 0 && (
          <span className="text-sm font-mono text-zinc-500">
            {unreadCount} 未读
          </span>
        )}
      </header>

      <nav className="mb-6 flex gap-1 border-b border-zinc-200">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                active
                  ? 'px-4 py-3 text-sm font-semibold text-zinc-900 border-b-2 border-zinc-900 -mb-px'
                  : 'px-4 py-3 text-sm text-zinc-500 hover:text-zinc-900 transition-colors'
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <div className="text-sm text-zinc-500 text-center py-12">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-12">暂无通知</div>
      ) : (
        <ul className="divide-y divide-zinc-200 border border-zinc-200 rounded-md overflow-hidden bg-zinc-50">
          {filtered.map((n) => (
            <li
              key={n.id}
              onClick={() => markRead(n)}
              className={`group flex items-stretch bg-white hover:bg-zinc-50 cursor-pointer transition-colors ${
                n.is_read ? 'opacity-50' : ''
              }`}
            >
              <div className={`w-[3px] shrink-0 ${SEVERITY_BG[n.severity]}`} aria-hidden />
              <div className="flex-1 min-w-0 px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium text-white uppercase tracking-wider ${SEVERITY_BG[n.severity]}`}
                  >
                    {TYPE_LABELS[n.type]}
                  </span>
                  {n.brand_code && (
                    <span className="text-xs px-2 py-0.5 bg-zinc-100 text-zinc-700 rounded-sm font-mono">
                      {n.brand_code}
                    </span>
                  )}
                  <span className="text-xs text-zinc-400 font-mono">
                    {formatTs(n.created_at)}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {n.action_label && (
                      <span className="text-sm text-blue-600 whitespace-nowrap">
                        {n.action_label} →
                      </span>
                    )}
                    <button
                      onClick={(e) => dismiss(e, n)}
                      className="text-zinc-600 hover:text-zinc-900 text-sm leading-none w-5 h-5 flex items-center justify-center rounded-sm transition-colors"
                      aria-label="关闭"
                    >
                      ×
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 font-medium text-zinc-900 truncate">{n.title}</div>
                {n.body && (
                  <div className="mt-0.5 text-sm text-zinc-500 truncate">{n.body}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
