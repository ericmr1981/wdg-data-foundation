// ui/src/components/chat/MessageList.tsx
'use client';
import { useState } from 'react';
import type { ChatMessage, ToolCallLite } from './types';

function ToolCallBlock({ call }: { call: ToolCallLite }) {
  const [open, setOpen] = useState(false);
  const status = call.isError ? '❌' : '✅';
  return (
    <div className="my-1 rounded border border-gray-200 bg-gray-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-2 py-1 text-left text-gray-700 hover:bg-gray-100"
      >
        {status} <code>{call.name}</code>
        {call.durationMs != null && <span className="ml-2 text-gray-400">{call.durationMs}ms</span>}
        {call.retry && (
          <span className="ml-2 text-yellow-600">重试 {call.retry.attempt}/{call.retry.maxAttempts}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-200 px-2 py-1">
          <div className="text-gray-500">input:</div>
          <pre className="overflow-auto text-[10px]">{JSON.stringify(call.input, null, 2)}</pre>
          {call.result && (
            <>
              <div className="mt-1 text-gray-500">result:</div>
              <pre className="overflow-auto text-[10px]">{call.result.slice(0, 2000)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
      {messages.map((m, i) => {
        if (m.type === 'user') {
          return (
            <div key={i} className="rounded bg-blue-50 px-3 py-2 text-gray-900">
              {m.content}
            </div>
          );
        }
        if (m.type === 'assistant_text') {
          return (
            <div key={i} className="rounded bg-white px-3 py-2 text-gray-900 shadow-sm">
              {m.content}
            </div>
          );
        }
        if (m.type === 'tool_call') {
          return <ToolCallBlock key={i} call={m.call} />;
        }
        if (m.type === 'thinking') {
          return (
            <div key={i} className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-1 text-xs italic text-gray-500">
              💭 {m.content}
            </div>
          );
        }
        if (m.type === 'token_notice') {
          return (
            <div key={i} className="rounded border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs text-yellow-800">
              ⚠️ Token 用量已达 {m.used} / 软限 {m.softLimit}（{m.level}）— 后续 prompt 已压缩
            </div>
          );
        }
        return (
          <div key={i} className="rounded bg-red-50 px-3 py-2 text-red-800">
            ⚠️ {m.message}
          </div>
        );
      })}
    </div>
  );
}
