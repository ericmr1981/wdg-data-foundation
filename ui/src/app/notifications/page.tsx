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

const SEVERITY_BADGE: Record<Severity, string> = {
  error: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-blue-700',
};

const TABS: Array<{ key: 'all' | NotificationType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'data_stale', label: '数据未更新' },
  { key: 'unmatched_txn', label: '未配条目' },
  { key: 'dup_rule', label: '重复匹配' },
  { key: 'monthly_report', label: '月报表' },
];

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [tab, setTab] = useState<'all' | NotificationType>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/notifications', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tab === 'all' ? items : items.filter((x) => x.type === tab);

  const handleClick = async (n: NotificationItem) => {
    if (!n.is_read) {
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

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">站内通知</h1>
      <div className="flex gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm ${
              tab === t.key ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-gray-500">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-center py-12">暂无通知</div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((n) => (
            <li
              key={n.id}
              onClick={() => handleClick(n)}
              className={`p-4 bg-white border rounded-lg cursor-pointer hover:shadow ${
                n.is_read ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_BADGE[n.severity]}`}>
                      {TYPE_LABELS[n.type]}
                    </span>
                    {n.brand_code && (
                      <span className="text-xs text-gray-500">{n.brand_code}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(n.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <div className="font-medium">{n.title}</div>
                  <div className="text-sm text-gray-600 mt-1">{n.body}</div>
                </div>
                {n.action_label && (
                  <span className="text-sm text-blue-600 whitespace-nowrap">{n.action_label} →</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
