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
import { callMcpWithRetry, McpCallError } from '@/lib/chat/mcp-bridge';
import { encodeSseEvent } from '@/lib/chat/stream';
import { checkRateLimit } from '@/lib/chat/rate-limit';
import { createTokenTracker } from '@/lib/chat/token-tracker';
import { getAgentConfig, applyConfigToGlobals } from '@/lib/chat/agent-config-store';
import { decrypt } from '@/lib/chat/secret-crypto';
import { splitSentences } from '@/lib/chat/sentence-splitter';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;  // seconds; 1 message turn

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

  // ---------- 1.6 apply runtime config to module-level globals ----------
  // (token limits + rate limit max). Call per-request so /api/admin/agent-config
  // updates take effect on the next request.
  applyConfigToGlobals();

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

  // ---------- 4. build tools (system prompt is re-evaluated per loop iteration) ----------
  const allTools = listToolSchemas();
  const tools = filterToolsByRole(user.role, allTools);

  // ---------- 4.5 token tracker (per session) ----------
  const tokens = createTokenTracker();
  let lastTokenLevel: 'normal' | 'soft' | 'hard' = 'normal';

  // ---------- 5. SSE stream ----------
  const cookieHeader = req.headers.get('cookie');
  const baseUrl = getBaseUrl(req);

  // Load credentials: prefer in-memory store, then DB (decrypted), then env.
  // Per-request so admin UI changes (or DELETE) take effect immediately.
  const cfg = getAgentConfig();
  let credApiKey: string | null = cfg.apiKey;
  let credBaseURL: string | null = cfg.baseURL;
  if (process.env.AGENT_CRED_ENCRYPTION_KEY) {
    try {
      const { rows } = await pool.query(
        'SELECT base_url, encrypted_api_key, model FROM ops.chat_agent_credentials WHERE id = 1',
      );
      if (rows.length > 0) {
        const row = rows[0];
        if (row.base_url) credBaseURL = row.base_url as string;
        if (row.encrypted_api_key) {
          credApiKey = decrypt(row.encrypted_api_key as string, process.env.AGENT_CRED_ENCRYPTION_KEY);
        }
      }
    } catch (err) {
      console.warn('[chat] DB credential load failed, falling back to store/env:', (err as Error).message);
    }
  }
  const apiKey = credApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response('AI service not configured (no ANTHROPIC_API_KEY)', { status: 503 });
  }
  const anthropicBaseURL = credBaseURL || process.env.ANTHROPIC_BASE_URL || undefined;
  const anthropicModel = cfg.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  const client = new Anthropic({
    apiKey,
    ...(anthropicBaseURL ? { baseURL: anthropicBaseURL } : {}),
  });

  // Convert stored messages → Anthropic format
  const apiMessages: Anthropic.MessageParam[] = sess.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(evt as { type: string })));
        } catch {
          // controller may be closed (e.g. onRetry fires after stream close); ignore
        }
      };
      try {
        send({ type: 'session', sessionId: sess.id });

        // Per-turn state for sentence-level streaming
        const turnId = `t${Date.now().toString(36)}`;
        let sentenceBuffer = '';
        let sentenceIndex = 0;
        const SENTENCE_FLUSH_THRESHOLD = 800;  // chars; if buffer grows past this without a terminator, force-flush
        const flushSentences = (final: boolean) => {
          if (!sentenceBuffer) return;
          // If buffer is huge with no terminator, force-flush so client sees progress
          if (!final && sentenceBuffer.length < SENTENCE_FLUSH_THRESHOLD) {
            // Try to cut complete sentences out, keep the rest
            const blocks = splitSentences(sentenceBuffer);
            if (blocks.length === 0) return;
            const last = blocks[blocks.length - 1];
            const hasTerminator = /[。！？.!?]\s*$/.test(last);
            if (!hasTerminator) {
              const completed = blocks.slice(0, -1);
              for (const text of completed) {
                send({ type: 'text_block', text, index: sentenceIndex++, turnId });
              }
              sentenceBuffer = last;
              return;
            }
            // Last block has terminator — emit all
            for (const text of blocks) {
              send({ type: 'text_block', text, index: sentenceIndex++, turnId });
            }
            sentenceBuffer = '';
            return;
          }
          // Either final flush OR buffer exceeded threshold: emit everything split,
          // keep remainder (only if not final)
          const blocks = splitSentences(sentenceBuffer);
          for (const text of blocks) {
            send({ type: 'text_block', text, index: sentenceIndex++, turnId });
          }
          sentenceBuffer = '';
        };

        let runningMessages = apiMessages;
        let stopReason: string | null = null;

        while (stopReason !== 'end_turn') {
          if (toolDepth >= cfg.params.maxToolChainDepth) {
            send({ type: 'error', message: 'tool chain too deep' });
            break;
          }

          // Re-evaluate system prompt each iteration based on current token level
          const system = buildSystemPrompt(
            sess.context,
            tools,
            {
              customInstructions: cfg.agentMd,
              compact: lastTokenLevel === 'soft' || lastTokenLevel === 'hard',
            },
          );

          const response = await client.messages.create({
            model: anthropicModel,
            system,
            tools: tools as Anthropic.Tool[],
            messages: runningMessages,
            max_tokens: cfg.params.maxTokens,
            temperature: cfg.params.temperature,
            ...(cfg.params.topP != null ? { top_p: cfg.params.topP } : {}),
          });

          // Record token usage for this round (defensive: usage may be missing)
          const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };
          const t = tokens.record(usage.input_tokens, usage.output_tokens);
          if (t.level === 'soft' && lastTokenLevel === 'normal') {
            send({
              type: 'token_warning',
              used: t.usage.inputTokens + t.usage.outputTokens,
              softLimit: 80_000,
              level: 'soft',
            });
          }
          if (t.level === 'hard') {
            send({ type: 'error', message: '对话超过 token 上限 (200K)，请重置会话后重试' });
            break;
          }
          lastTokenLevel = t.level;

          // Stream text + collect tool_use blocks
          const assistantTextParts: string[] = [];
          const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];

          for (const block of response.content) {
            if (block.type === 'text') {
              assistantTextParts.push(block.text);
              send({ type: 'text_delta', text: block.text });  // fallback for old clients
              sentenceBuffer += block.text;
              flushSentences(false);
            } else if (block.type === 'tool_use') {
              // Flush any completed sentences before the tool call (so the
              // user sees prose complete before tool_call block appears)
              flushSentences(false);
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
            const result = await callMcpWithRetry(
              {
                jsonrpc: '2.0',
                id: rpcIdCounter++,
                method: 'tools/call',
                params: { name: tb.name, arguments: tb.input as Record<string, unknown> },
              },
              cookieHeader,
              baseUrl,
              (attempt, max, err) => {
                send({ type: 'tool_retry', id: tb.id, name: tb.name, attempt, maxAttempts: max, lastError: err.message });
              },
              cfg.params.mcpRetryMaxAttempts,
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

        flushSentences(true);
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
