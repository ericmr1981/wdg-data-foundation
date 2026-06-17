// ui/src/components/chat/ChatWidget.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ChatDrawer } from './ChatDrawer';
import { parseSseStream } from '@/lib/chat/stream';
import { useDrawerState } from '@/lib/chat/use-drawer-state';
import { shouldUseAgentService, getAgentWsUrl } from '@/lib/feature-flags';
import type { ChatMessage, SseIncoming, ToolCallLite } from './types';

/**
 * v1 path: open a WebSocket to the Agent Service and stream SSE-shaped
 * JSON events back into the same ChatMessage list that the v0 path uses.
 * Each WS text frame is one SSE record (`event: <type>\ndata: <json>\n\n`),
 * which we parse with the existing parseSseStream helper so renderer code
 * stays unchanged. This is the only place the WS protocol is referenced.
 */
async function sendViaAgent(
  text: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): Promise<void> {
  // userId is required to enter this path (feature flag returns false otherwise),
  // but we still read it from the server to avoid drift on rollout changes.
  const meRes = await fetch('/api/auth/me');
  if (!meRes.ok) throw new Error('auth required');
  const meJson = await meRes.json();
  const userId = meJson?.data?.user_id ? String(meJson.data.user_id) : '';
  if (!userId) throw new Error('no user id');

  const base = getAgentWsUrl();
  const url = `${base}?userId=${encodeURIComponent(userId)}`;
  const ws = new WebSocket(url);
  // Optional: surface connection errors as assistant error bubbles
  ws.onerror = () => {
    setMessages(m => [...m, { type: 'error', message: 'agent service unavailable', ts: Date.now() }]);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onclose = () => resolve();
    ws.onerror = (e) => reject(new Error('ws open failed'));
  });
  if (ws.readyState !== WebSocket.OPEN) throw new Error('ws not open');
  const clientTs = Date.now();
  ws.send(JSON.stringify({ type: 'message', text, ts: clientTs }));

  // Accumulate frames and parse the SSE stream. We translate the same
  // SseIncoming union into setMessages calls so the renderer doesn't care
  // which transport produced the events.
  let buf = '';
  const toolCalls = new Map<string, ToolCallLite>();
  await new Promise<void>((resolve) => {
    ws.onmessage = (ev) => {
      buf += String(ev.data);
      parseSseStream(buf, (raw) => {
        const evt = raw as SseIncoming;
        if (evt.type === 'text_block' && typeof evt.text === 'string') {
          setMessages(m => [...m, { type: 'assistant_text', content: evt.text, ts: Date.now() }]);
        } else if (evt.type === 'text_delta' && typeof evt.text === 'string') {
          // text_delta is a sub-block delta; append to a hidden buffer.
          // Without this branch the v0 renderer would lose intra-block deltas.
          // For now we ignore; the matching text_block will render the chunk.
        } else if (evt.type === 'thinking_delta' && typeof evt.text === 'string') {
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
          toolCalls.set(evt.id, tc);
          setMessages(m => [...m, { type: 'tool_call', call: tc, ts: Date.now() }]);
        } else if (evt.type === 'tool_end') {
          const tc = toolCalls.get(evt.id);
          if (tc) {
            tc.result = evt.summary;
            tc.isError = !!evt.isError;
            tc.durationMs = evt.durationMs;
            setMessages(m => m.map(x => (x.type === 'tool_call' && x.call.id === evt.id) ? { ...x, call: { ...tc } } : x));
          }
        } else if (evt.type === 'error') {
          setMessages(m => [...m, { type: 'error', message: evt.message, ts: Date.now() }]);
        } else if (evt.type === 'done') {
          ws.close();
          resolve();
        }
      });
      const lastSep = buf.lastIndexOf('\n\n');
      if (lastSep >= 0) buf = buf.slice(lastSep + 2);
    };
    ws.onclose = () => resolve();
    ws.onerror = () => resolve();
  });
}

export function ChatWidget() {
  const { open, setOpen, toggle } = useDrawerState();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const aborterRef = useRef<AbortController | null>(null);
  const assistantBufferRef = useRef<string>('');
  const toolCallsRef = useRef<Map<string, ToolCallLite>>(new Map());

  // Resolve current userId (from /api/auth/me) once on mount. Used by the
  // agent-service feature flag for sticky per-user rollout. We don't block
  // chat on this — if /me fails (e.g. logged out), the flag returns false
  // and the user stays on the v0 chat path.
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && j.success && j.data && j.data.user_id) {
          setUserId(String(j.data.user_id));
        }
      })
      .catch(() => { /* keep userId=null, fall through to v0 */ });
  }, []);

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

  const send = useCallback(async (text: string, file?: File) => {
    if (streaming) return;
    const ts = Date.now();
    // Show file info in the user's message bubble
    const userContent = file ? `[📎 ${file.name}] ${text}` : text;
    setMessages(m => [...m, { type: 'user', content: userContent, ts }]);
    setStreaming(true);
    assistantBufferRef.current = '';
    toolCallsRef.current = new Map();

    // Feature flag: when the rollout hash matches, route to the new Agent
    // Service (WebSocket). v0 is the default (ROLLOUT_PERCENT=0) and the
    // existing /api/chat path is preserved below.
    if (shouldUseAgentService(userId)) {
      try {
        await sendViaAgent(text, setMessages);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setMessages(m => [...m, { type: 'error', message: (e as Error).message, ts: Date.now() }]);
        }
      } finally {
        setStreaming(false);
        aborterRef.current = null;
      }
      return;
    }

    const controller = new AbortController();
    aborterRef.current = controller;
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append('text', text);
        form.append('file', file);
        res = await fetch('/api/chat', {
          method: 'POST',
          body: form,
          signal: controller.signal,
          redirect: 'error',
        });
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
          redirect: 'error',
        });
      }
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
            // Append to the last 'assistant_text' block, or create one.
            // This merges all sentences from the same assistant turn into a
            // single bubble instead of one bubble per sentence.
            setMessages(m => {
              const copy = m.slice();
              const last = copy[copy.length - 1];
              if (last && last.type === 'assistant_text') {
                copy[copy.length - 1] = { ...last, content: last.content + evt.text };
              } else {
                copy.push({ type: 'assistant_text', content: evt.text, ts: Date.now() });
              }
              return copy;
            });
            // Reset the legacy buffer state so a future text_delta doesn't
            // leave a half-populated buffer around.
            assistantBufferRef.current = '';
            lastAssistantTs = Date.now();
            assistantStarted = false;
          } else if (evt.type === 'text_delta' && typeof evt.text === 'string') {
            // The new server emits BOTH text_delta and text_block for every
            // text block (text_delta is kept for backward compat). Push a
            // message ONLY from text_block (the per-sentence chunked event);
            // here, just accumulate into the buffer for any legacy / fallback
            // code paths that read it. Never call flushAssistantText() in
            // this handler — that would render the raw block text a second
            // time on top of the text_block bubble.
            assistantBufferRef.current += evt.text;
            lastAssistantTs = Date.now();
            // Note: do NOT call flushAssistantText() here. The old code path's
            // "single big bubble" behavior is no longer used; if text_block
            // never arrives the user simply doesn't see streaming bubbles
            // for this turn, and history will be restored on next page load.
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
  }, [streaming, userId]);

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
      <ChatInput onSend={send} disabled={streaming} canUpload={true} />
    </ChatDrawer>
  );
}
