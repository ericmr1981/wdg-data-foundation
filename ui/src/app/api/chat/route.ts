// ui/src/app/api/chat/route.ts
// Spec §3 / §4.3: main SSE endpoint. Runs the Claude tool-use loop and
// streams progress to the browser.

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionUser } from '@/lib/auth-server';
import { getOrCreateSession, appendMessage, updateSession } from '@/lib/chat/session-store';
import { listToolSchemas } from '@/mcp/server';
import { filterToolsByRole, isWriteAllowedForRole, ALLOWED_WRITE_TOOLS } from '@/lib/chat/auth';
import { buildSystemPrompt } from '@/lib/chat/prompt';
import { callMcp, McpCallError } from '@/lib/chat/mcp-bridge';
import { encodeSseEvent } from '@/lib/chat/stream';
import { checkRateLimit } from '@/lib/chat/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;  // seconds; 1 message turn

const MAX_TOOL_CHAIN_DEPTH = 5;

function getBaseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  // ---------- 1. auth ----------
  const user = await getSessionUser();
  if (!user) {
    return new Response('unauthorized', { status: 401 });
  }

  // ---------- 1.5 rate limit ----------
  const rl = checkRateLimit(user.user_id);
  if (!rl.ok) {
    return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    });
  }

  // ---------- 2. parse body (text or multipart) ----------
  const contentType = req.headers.get('content-type') ?? '';
  let userText = '';
  let toolDepth = 0;
  let rpcIdCounter = 1;
  let sessionId: string | null = null;

  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData();
    userText = (form.get('text') as string | null) ?? '';
    // files are dropped at the SSE endpoint in v1 — they go through
    // a separate /api/upload flow. We accept the field but ignore it.
  } else {
    const body = await req.json().catch(() => ({}));
    userText = (body.text as string | null) ?? '';
  }

  if (!userText.trim()) {
    return new Response('empty message', { status: 400 });
  }

  // ---------- 3. session ----------
  const sess = getOrCreateSession(user.user_id);
  sessionId = sess.id;
  appendMessage(sess.id, { role: 'user', content: userText, ts: Date.now() });

  // ---------- 4. build prompt + tools ----------
  const allTools = listToolSchemas();
  const tools = filterToolsByRole(user.role, allTools);
  const system = buildSystemPrompt(sess.context, tools);

  // ---------- 5. SSE stream ----------
  const cookieHeader = req.headers.get('cookie');
  const baseUrl = getBaseUrl(req);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Convert stored messages → Anthropic format
  const apiMessages: Anthropic.MessageParam[] = sess.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(encodeSseEvent(evt as { type: string })));
      };
      try {
        send({ type: 'session', sessionId: sess.id });

        let runningMessages = apiMessages;
        let stopReason: string | null = null;

        while (stopReason !== 'end_turn') {
          if (toolDepth >= MAX_TOOL_CHAIN_DEPTH) {
            send({ type: 'error', message: 'tool chain too deep' });
            break;
          }

          const response = await client.messages.create({
            model: 'claude-opus-4-8',
            system,
            tools: tools as Anthropic.Tool[],
            messages: runningMessages,
            max_tokens: 4096,
          });

          // Stream text + collect tool_use blocks
          const assistantTextParts: string[] = [];
          const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];

          for (const block of response.content) {
            if (block.type === 'text') {
              assistantTextParts.push(block.text);
              send({ type: 'text_delta', text: block.text });
            } else if (block.type === 'tool_use') {
              toolUseBlocks.push({ id: block.id, name: block.name, input: block.input });
              send({ type: 'tool_start', id: block.id, name: block.name });
            }
          }

          stopReason = response.stop_reason ?? null;

          // Persist assistant turn
          const assistantContent = assistantTextParts.join('\n');
          if (assistantContent || toolUseBlocks.length) {
            appendMessage(sess.id, {
              role: 'assistant',
              content: assistantContent,
              toolCalls: toolUseBlocks.map(tb => ({ id: tb.id, name: tb.name, input: tb.input })),
              ts: Date.now(),
            });
          }

          // No tool calls → done
          if (toolUseBlocks.length === 0 || stopReason === 'end_turn') break;

          // Execute each tool_use
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
          for (const tb of toolUseBlocks) {
            // Server-side write whitelist guard
            if (ALLOWED_WRITE_TOOLS.has(tb.name) && !isWriteAllowedForRole(user.role, tb.name)) {
              const errText = 'WRITE_NOT_ALLOWED';
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: errText, is_error: true });
              send({ type: 'tool_end', id: tb.id, name: tb.name, isError: true, summary: errText });
              continue;
            }
            const t0 = Date.now();
            const result = await callMcp(
              {
                jsonrpc: '2.0',
                id: rpcIdCounter++,
                method: 'tools/call',
                params: { name: tb.name, arguments: tb.input as Record<string, unknown> },
              },
              cookieHeader,
              baseUrl,
            );
            const durMs = Date.now() - t0;
            if (result instanceof McpCallError) {
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result.message, is_error: true });
              send({ type: 'tool_end', id: tb.id, name: tb.name, isError: true, summary: result.message, durationMs: durMs });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result.text });
              send({ type: 'tool_end', id: tb.id, name: tb.name, summary: result.text.slice(0, 200), durationMs: durMs });
            }
          }
          toolDepth++;

          // Feed results back to Claude
          runningMessages = [
            ...runningMessages,
            { role: 'assistant' as const, content: response.content as Anthropic.ContentBlockParam[] },
            { role: 'user' as const, content: toolResults },
          ];
        }

        send({ type: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Log server-side; send generic to client for 401/403
        console.error('[chat] error:', msg);
        if (msg.includes('401') || msg.includes('authentication')) {
          send({ type: 'error', message: 'AI service not configured (ANTHROPIC_API_KEY missing or invalid)' });
        } else {
          send({ type: 'error', message: msg });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
    },
  });
}
