'use client';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ToolCallLite } from './types';
import { UserAvatar } from './UserAvatar';
import { MarkdownMessage } from './MarkdownMessage';
import { JsonBlock } from './JsonBlock';

function ToolCallBlock({ call }: { call: ToolCallLite }) {
  const [open, setOpen] = useState(false);
  const status = call.isError ? '❌' : '✅';
  // Parse result for syntax highlighting (it's typically a JSON string)
  let parsedResult: unknown = call.result;
  try {
    if (typeof call.result === 'string' && call.result.trim().startsWith('{')) {
      parsedResult = JSON.parse(call.result);
    }
  } catch { /* leave as string */ }

  return (
    <div className="my-1 overflow-hidden rounded border border-slate-200 bg-slate-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100"
      >
        <span className="font-mono">{status}</span>
        <code className="font-mono text-[11px] font-semibold">{call.name}</code>
        {call.durationMs != null && (
          <span className="text-slate-400">{call.durationMs}ms</span>
        )}
        {call.retry && (
          <span className="text-yellow-600">重试 {call.retry.attempt}/{call.retry.maxAttempts}</span>
        )}
        <span className="ml-auto text-slate-400">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-2">
          <JsonBlock data={call.input} label="input" />
          {call.result && <JsonBlock data={parsedResult} label="result" />}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages change (new content or streaming)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={containerRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-3">
      {messages.map((m, i) => {
        if (m.type === 'user') {
          return (
            <div key={i} className="flex items-start justify-end gap-2">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-500 px-3 py-2 text-sm text-white shadow-sm">
                {m.content}
              </div>
              <UserAvatar role="user" />
            </div>
          );
        }
        if (m.type === 'assistant_text') {
          return (
            <div key={i} className="flex items-start justify-start gap-2">
              <UserAvatar role="assistant" />
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                <MarkdownMessage content={m.content} />
              </div>
            </div>
          );
        }
        if (m.type === 'tool_call') {
          return <ToolCallBlock key={i} call={m.call} />;
        }
        if (m.type === 'thinking') {
          return (
            <div key={i} className="mx-2 rounded border border-dashed border-gray-200 bg-white px-3 py-1 text-xs italic text-gray-500">
              💭 {m.content}
            </div>
          );
        }
        if (m.type === 'token_notice') {
          return (
            <div key={i} className="rounded border border-yellow-200 bg-yellow-50 px-3 py-1 text-center text-xs text-yellow-800">
              ⚠️ Token 用量已达 {m.used} / 软限 {m.softLimit}（{m.level}）— 后续 prompt 已压缩
            </div>
          );
        }
        if (m.type === 'error') {
          return (
            <div key={i} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800">
              ⚠️ {m.message}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
