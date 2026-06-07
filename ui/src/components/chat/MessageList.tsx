'use client';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ToolCallLite } from './types';
import { UserAvatar } from './UserAvatar';
import { MarkdownMessage } from './MarkdownMessage';
import { JsonBlock } from './JsonBlock';

function ToolCallBlock({ call }: { call: ToolCallLite }) {
  const [open, setOpen] = useState(false);
  const status = call.isError ? '❌' : '✅';
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

function FadeInBlock({ children, delayMs = 0 }: { children: React.ReactNode; delayMs?: number }) {
  // CSS @keyframes defined in tailwind.config.js (Task 8). `animation-delay`
  // staggers consecutive blocks so a batch of N text_blocks emitted ~simultaneously
  // by the server fade in one-by-one (each ~70ms after the previous) instead
  // of all at once. delayMs=0 (default) is used for the first block of a
  // batch and for blocks loaded from history (which are not staggered).
  return (
    <div
      className="animate-fadeIn will-change-transform"
      style={delayMs > 0 ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  // Collapsed by default — thinking text is verbose; users usually just
  // want the final answer. Same expand-on-click pattern as ToolCallBlock.
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 overflow-hidden rounded border border-dashed border-gray-200 bg-white text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left italic text-gray-500 hover:bg-gray-50"
        aria-expanded={open}
      >
        <span>💭</span>
        <span>{open ? '思考中…' : `已思考 (${content.length} 字)`}</span>
        <span className="ml-auto">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="border-t border-dashed border-gray-200 px-3 py-2 italic text-gray-600 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

const STAGGER_MS = 140;        // delay between consecutive blocks in a batch
const BATCH_GAP_MS = 1000;     // blocks emitted > 1s apart are considered separate batches (no stagger)

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={containerRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-3">
      {(() => {
        // Walk messages once to compute per-block animation delay.
        // Consecutive assistant_text blocks whose ts are within BATCH_GAP_MS
        // of each other get a staggered delay so the fade-in feels sequential.
        // Blocks from history (or a fresh turn's first block) get delay=0.
        let prevAssistantTs = -Infinity;
        let batchIdx = 0;
        return messages.map((m, i) => {
          if (m.type === 'assistant_text') {
            const gap = m.ts - prevAssistantTs;
            const inBatch = gap >= 0 && gap < BATCH_GAP_MS;
            const delayMs = inBatch ? batchIdx * STAGGER_MS : 0;
            if (inBatch) batchIdx++; else batchIdx = 1;  // this block is now the first of a new batch
            prevAssistantTs = m.ts;
            return (
              <FadeInBlock key={i} delayMs={delayMs}>
                <div className="flex items-start justify-start gap-2">
                  <UserAvatar role="assistant" />
                  <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                    <MarkdownMessage content={m.content} />
                  </div>
                </div>
              </FadeInBlock>
            );
          }
          // Non-assistant_text: reset batch state (a user message, tool call,
          // or notice breaks the visual stream).
          prevAssistantTs = -Infinity;
          batchIdx = 0;
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
          if (m.type === 'tool_call') {
            return <ToolCallBlock key={i} call={m.call} />;
          }
          if (m.type === 'thinking') {
            return <ThinkingBlock key={i} content={m.content} />;
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
        });
      })()}
    </div>
  );
}
