'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationItem, NotificationListResponse, Severity } from '@/lib/notification-types';

const SEVERITY_BORDER: Record<Severity, string> = {
  error: 'border-l-red-600',
  warn: 'border-l-amber-500',
  info: 'border-l-blue-600',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
    load();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleItem = async (n: NotificationItem) => {
    if (!n.is_read) {
      try {
        await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
      } catch {
        // ignore
      }
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
    try {
      await fetch(`/api/notifications/${id}/dismiss`, { method: 'POST' });
    } catch {
      // ignore
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const handleReadAll = async () => {
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    } catch {
      // ignore
    }
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
  };

  const visible = items.slice(0, 20);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="通知"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] font-semibold rounded-sm px-1 min-w-[18px] h-[18px] flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="通知" className="absolute right-0 mt-2 w-96 max-h-[480px] flex flex-col bg-zinc-50 border border-zinc-200 rounded-md shadow-md z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
            <span className="font-display text-sm text-zinc-900">
              通知 <span className="font-mono text-xs text-zinc-500">({unread} 未读)</span>
            </span>
            <button type="button" onClick={handleReadAll} disabled={unread === 0} className="text-xs text-blue-600 font-medium disabled:text-zinc-400 disabled:cursor-not-allowed">
              全部已读
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="py-10 text-center text-sm text-zinc-500">暂无通知</div>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {visible.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => handleItem(n)}
                    className={`group cursor-pointer border-l-[3px] ${SEVERITY_BORDER[n.severity]} hover:bg-white ${n.is_read ? 'opacity-50' : ''}`}
                  >
                    <div className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-zinc-900 truncate">{n.title}</span>
                          <span className="font-mono text-xs text-zinc-400 shrink-0">{formatTime(n.created_at)}</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{n.body}</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          {n.brand_code && <span className="font-mono text-[10px] text-zinc-500">{n.brand_code}</span>}
                          {n.action_label && <span className="text-xs text-blue-600 font-medium">{n.action_label} →</span>}
                        </div>
                      </div>
                      <button type="button" onClick={(e) => handleDismiss(n.id, e)} aria-label="关闭" className="text-zinc-400 hover:text-zinc-700 text-sm leading-none p-1 -m-1">
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-4 py-2 border-t border-zinc-200 text-center">
            <a href="/notifications" className="text-xs text-zinc-700 hover:text-zinc-900 font-medium">查看全部 →</a>
          </div>
        </div>
      )}
    </div>
  );
}
