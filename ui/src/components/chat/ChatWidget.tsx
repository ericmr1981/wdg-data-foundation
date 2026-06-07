// ui/src/components/chat/ChatWidget.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ChatDrawer } from './ChatDrawer';
import { parseSseStream } from '@/lib/chat/stream';
import { useDrawerState } from '@/lib/chat/use-drawer-state';
import type { ChatMessage, SseIncoming, ToolCallLite } from './types';

export function ChatWidget() {
  const { open, setOpen, toggle } = useDrawerState();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const aborterRef = useRef<AbortController | null>(null);
  const assistantBufferRef = useRef<string>('');
  const toolCallsRef = useRef<Map<string, ToolCallLite>>(new Map());

  // Cmd/Ctrl+K global toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Load history on mount
  useEffect(() => {
    if (!open) return;
    fetch('/api/chat/history').then(async r => {
      if (!r.ok) return;
      const j = await r.json();
      const restored: ChatMessage[] = [];
      for (const m of (j.messages as Array<{ role: string; content: string; toolCalls?: ToolCallLite[]; ts: number }>)) {
        if (m.role === 'user') restored.push({ type: 'user', content: m.content, ts: m.ts });
        else {
          if (m.content) restored.push({ type: 'assistant_text', content: m.content, ts: m.ts });
          for (const tc of m.toolCalls ?? []) {
            restored.push({ type: 'tool_call', call: tc, ts: m.ts });
          }
        }
      }
      setMessages(restored);
    }).catch(() => {});
  }, [open]);

  const send = useCallback(async (text: string) => {
    if (streaming) return;
    const ts = Date.now();
    setMessages(m => [...m, { type: 'user', content: text, ts }]);
    setStreaming(true);
    assistantBufferRef.current = '';
    toolCallsRef.current = new Map();

    const controller = new AbortController();
    aborterRef.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setMessages(m => [...m, { type: 'error', message: `HTTP ${res.status}`, ts: Date.now() }]);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Buffers for current assistant turn
      let assistantStarted = false;
      let lastAssistantTs = ts;

      const flushAssistantText = () => {
        if (!assistantStarted) {
          setMessages(m => [...m, { type: 'assistant_text', content: assistantBufferRef.current, ts: lastAssistantTs }]);
          assistantStarted = true;
        } else {
          // Replace the last assistant_text message with the new buffer
          setMessages(m => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].type === 'assistant_text') {
                copy[i] = { type: 'assistant_text', content: assistantBufferRef.current, ts: copy[i].ts };
                break;
              }
            }
            return copy;
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        parseSseStream(buf, (raw) => {
          const evt = raw as SseIncoming;
          if (evt.type === 'text_block' && typeof evt.text === 'string') {
            // Per-sentence chunk from server's splitSentences. Each block is a
            // complete sentence; push as a new assistant_text message so
            // MessageList's FadeInBlock animates it.
            setMessages(m => [...m, { type: 'assistant_text', content: evt.text, ts: Date.now() }]);
            // Reset the legacy buffer state so the next text_delta (if any
            // arrives in fallback mode) creates a fresh message instead of
            // appending to the just-emitted text_block.
            assistantBufferRef.current = '';
            lastAssistantTs = Date.now();
            assistantStarted = false;
          } else if (evt.type === 'text_delta' && typeof evt.text === 'string') {
            // Fallback / old-server path: accumulate in legacy buffer.
            assistantBufferRef.current += evt.text;
            lastAssistantTs = Date.now();
            flushAssistantText();
          } else if (evt.type === 'thinking_delta' && typeof evt.text === 'string') {
            // Append to the last 'thinking' block, or create one
            setMessages(m => {
              const copy = m.slice();
              const last = copy[copy.length - 1];
              if (last && last.type === 'thinking') {
                copy[copy.length - 1] = { ...last, content: last.content + evt.text };
              } else {
                copy.push({ type: 'thinking', content: evt.text, ts: Date.now() });
              }
              return copy;
            });
          } else if (evt.type === 'tool_start') {
            const tc: ToolCallLite = { id: evt.id, name: evt.name, input: {} };
            toolCallsRef.current.set(evt.id, tc);
            setMessages(m => [...m, { type: 'tool_call', call: tc, ts: Date.now() }]);
          } else if (evt.type === 'tool_retry') {
            // Annotate the existing tool_call block with retry info
            setMessages(m => m.map(x => (x.type === 'tool_call' && x.call.id === evt.id)
              ? { ...x, call: { ...x.call, retry: { attempt: evt.attempt, maxAttempts: evt.maxAttempts, lastError: evt.lastError } } }
              : x));
          } else if (evt.type === 'tool_end') {
            const tc = toolCallsRef.current.get(evt.id);
            if (tc) {
              tc.result = evt.summary;
              tc.isError = !!evt.isError;
              tc.durationMs = evt.durationMs;
              setMessages(m => m.map(x => (x.type === 'tool_call' && x.call.id === evt.id) ? { ...x, call: { ...tc } } : x));
            }
          } else if (evt.type === 'token_warning') {
            setMessages(m => [...m, { type: 'token_notice', level: evt.level, used: evt.used, softLimit: evt.softLimit, ts: Date.now() }]);
          } else if (evt.type === 'error') {
            setMessages(m => [...m, { type: 'error', message: evt.message, ts: Date.now() }]);
          }
        });
        // The parser is stateless; after each chunk, keep the tail (after the last \n\n) in buf
        const lastSep = buf.lastIndexOf('\n\n');
        if (lastSep >= 0) buf = buf.slice(lastSep + 2);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(m => [...m, { type: 'error', message: (e as Error).message, ts: Date.now() }]);
      }
    } finally {
      setStreaming(false);
      aborterRef.current = null;
    }
  }, [streaming]);

  const reset = useCallback(async () => {
    await fetch('/api/chat/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });
    setMessages([]);
  }, []);

  return (
    <ChatDrawer
      title="AI 助手"
      headerRight={
        <button
          type="button"
          onClick={reset}
          className="rounded border border-white/40 px-2 py-0.5 text-xs text-white hover:bg-white/10"
        >🔄 重启</button>
      }
    >
      <MessageList messages={messages} />
      <ChatInput onSend={send} onReset={reset} disabled={streaming} />
    </ChatDrawer>
  );
}
