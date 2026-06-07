'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationListResponse, NotificationItem, Severity } from '@/lib/notification-types';

const SEVERITY_COLORS: Record<Severity, string> = {
  error: 'border-l-4 border-red-500',
  warn: 'border-l-4 border-amber-500',
  info: 'border-l-4 border-blue-400',
};

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data: NotificationListResponse = await res.json();
      setItems(data.items);
      setUnread(data.unread_count);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    load();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleClick = async (n: NotificationItem) => {
    if (!n.is_read) {
      await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    if (n.action_url) {
      if (n.action_url.startsWith('/api/')) {
        window.location.href = n.action_url;
      } else {
        router.push(n.action_url);
      }
    }
    setOpen(false);
  };

  const handleDismiss = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/notifications/${id}/dismiss`, { method: 'POST' });
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const handleReadAll = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
  };

  const visible = items.slice(0, 20);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="通知"
        className="relative p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <span className="text-xl">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1.5 min-w-[18px] text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 max-h-[480px] overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-medium">通知 ({unread} 未读)</span>
            <button
              onClick={handleReadAll}
              disabled={unread === 0}
              className="text-sm text-blue-600 disabled:opacity-50"
            >
              全部已读
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">暂无通知</div>
          ) : (
            visible.map((n) => (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer ${SEVERITY_COLORS[n.severity]} ${
                  n.is_read ? 'opacity-60' : ''
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{n.title}</div>
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{n.body}</div>
                    {n.action_label && (
                      <span className="inline-block mt-1 text-xs text-blue-600">{n.action_label} →</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDismiss(n.id, e)}
                    className="text-gray-400 hover:text-gray-600 text-sm"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
          <div className="p-2 border-t text-center">
            <a href="/notifications" className="text-sm text-blue-600 hover:underline">
              查看全部
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
