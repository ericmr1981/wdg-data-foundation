// ui/src/components/chat/ChatDrawer.tsx
'use client';
import { ReactNode, useEffect, useRef } from 'react';
import { useDrawerState, DRAWER_LIMITS } from '@/lib/chat/use-drawer-state';

interface Props {
  children: ReactNode;        // typically <MessageList /> + <ChatInput />
  headerRight?: ReactNode;    // optional: admin gear, reset button
  title?: string;
}

export function ChatDrawer({ children, headerRight, title = 'AI 助手' }: Props) {
  const { open, width, setOpen, setWidth } = useDrawerState();
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Push the CSS var onto :root so a layout wrapper can read it
  useEffect(() => {
    const root = document.documentElement;
    if (open) {
      root.style.setProperty('--chat-drawer-w', `${width}px`);
    } else {
      root.style.setProperty('--chat-drawer-w', '0px');
    }
    return () => { root.style.setProperty('--chat-drawer-w', '0px'); };
  }, [open, width]);

  // Drag handle: left edge, 4px wide
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: width };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    setWidth(dragRef.current.startW + dx);
  }
  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="AI 助手 (Cmd/Ctrl+K)"
        className="fixed bottom-8 right-8 z-50 h-12 w-12 rounded-full bg-blue-600 text-2xl text-white shadow-lg hover:bg-blue-700"
      >💬</button>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label={title}
      className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-gray-300 bg-white shadow-2xl"
      style={{
        width: width,
        transform: 'translateX(0)',
        transition: 'transform 220ms ease',
      }}
    >
      <header className="flex items-center justify-between border-b border-gray-200 bg-blue-600 px-3 py-2 text-white">
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex items-center gap-2">
          {headerRight}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="收起"
            className="text-white hover:text-gray-200"
          >✕</button>
        </div>
      </header>
      <div className="relative flex flex-1 overflow-hidden">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽改变宽度"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-300"
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
      <span className="sr-only">
        抽屉宽度范围 {DRAWER_LIMITS.MIN_W}~{DRAWER_LIMITS.MAX_W} 像素,当前 {width} 像素
      </span>
    </aside>
  );
}
