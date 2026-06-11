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
import { getAgentConfig, applyConfigToGlobals, thinkingConfigFor, THINKING_BUDGET, hydrateConfigFromDb } from '@/lib/chat/agent-config-store';
import { decrypt } from '@/lib/chat/secret-crypto';
import { splitSentences } from '@/lib/chat/sentence-splitter';
import { processStream } from '@/lib/chat/stream-processor';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
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
  // Hydrate from DB on first request if not already loaded.
  await hydrateConfigFromDb(pool);
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
    const file = form.get('file') as File | null;
    // Save uploaded file to staging dir and build a preview message for the model.
    // We need the session before staging — create/update after session init below.
    // Store the file info temporarily; session is created a few lines down.
    const filePayload: { file: File; text: string } | null = file && file.name
      ? { file, text: userText }
      : null;

    if (filePayload) {
      try {
        // Create a preliminary session-like id just for staging dir naming
        const stagingUserId = user.user_id;
        const stagingDir = join(process.cwd(), '..', 'inputs', '_staging', stagingUserId);
        mkdirSync(stagingDir, { recursive: true });
        const destPath = join(stagingDir, filePayload.file.name);
        const buf = Buffer.from(await filePayload.file.arrayBuffer());
        writeFileSync(destPath, buf);

        // Build a preview: column names + first 5 rows for xlsx/csv
        let filePreview = '';
        try {
          const ext = filePayload.file.name.split('.').pop()?.toLowerCase();
          if (ext === 'csv') {
            // Parse CSV via xlsx (already installed) — read as single-sheet workbook
            const XLSX = await import('xlsx');
            const wb = XLSX.read(buf.toString('utf-8').slice(0, 256 * 1024), { type: 'string', raw: true });
            const sheetName = wb.SheetNames[0];
            const data: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
            if (data.length > 0) {
              const headers = data[0].map((c: any) => String(c ?? ''));
              filePreview = `列名: ${headers.join(', ')}\n前${Math.min(data.length - 1, 5)}行:\n`;
              for (let i = 1; i < Math.min(data.length, 6); i++) {
                const row: Record<string, unknown> = {};
                headers.forEach((h: string, ci: number) => { row[h] = data[i]?.[ci] ?? null; });
                filePreview += `${JSON.stringify(row)}\n`;
              }
            }
          } else if (ext === 'xlsx' || ext === 'xls') {
            const XLSX = await import('xlsx');
            const wb = XLSX.read(buf, { type: 'buffer' });
            const sheetName = wb.SheetNames[0];
            const data: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
            if (data.length > 0) {
              const headers = data[0].map((c: any) => String(c ?? ''));
              filePreview = `列名: ${headers.join(', ')}\n前${Math.min(data.length - 1, 5)}行:\n`;
              for (let i = 1; i < Math.min(data.length, 6); i++) {
                const row: Record<string, unknown> = {};
                headers.forEach((h: string, ci: number) => { row[h] = data[i]?.[ci] ?? null; });
                filePreview += `${JSON.stringify(row)}\n`;
              }
            }
          }
        } catch {
          filePreview = `(无法解析文件预览)`;
        }

        // Augment userText with file metadata so the model sees it
        const fileInfo = `[用户上传了文件: ${filePayload.file.name} (${(buf.length / 1024).toFixed(1)}KB)]\n服务器路径: ${destPath}\n${filePreview ? '数据预览:\n' + filePreview : '(无预览)'}`;
        userText = filePayload.text ? `${fileInfo}\n\n用户消息: ${filePayload.text}` : fileInfo;
      } catch (err) {
        console.error('[chat] file upload staging failed:', err);
        userText = `${userText}\n\n[文件上传失败: ${(err as Error).message}]`;
      }
    }
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

          const thinkingCfg = thinkingConfigFor(cfg.params.thinkingLevel);

          // Per-turn state for sentence-level streaming
          const turnId = `t${Date.now().toString(36)}`;
          let sentenceBuffer = '';
          let sentenceIndex = 0;
          const SENTENCE_FLUSH_THRESHOLD = 800;  // chars; force-flush if buffer grows past this without a terminator
          const flushSentences = (final: boolean) => {
            if (!sentenceBuffer) return;
            if (!final && sentenceBuffer.length < SENTENCE_FLUSH_THRESHOLD) {
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
              for (const text of blocks) {
                send({ type: 'text_block', text, index: sentenceIndex++, turnId });
              }
              sentenceBuffer = '';
              return;
            }
            const blocks = splitSentences(sentenceBuffer);
            for (const text of blocks) {
              send({ type: 'text_block', text, index: sentenceIndex++, turnId });
            }
            sentenceBuffer = '';
          };

          // Bridge: processStream yields text via onTextDelta callback;
          // we accumulate into the sentence buffer and try to flush.
          const onTextDelta = (t: string) => {
            sentenceBuffer += t;
            flushSentences(false);
          };

          // Create a stream and iterate events. The stream accumulates
          // per-block state and forwards each delta to the SSE sender.
          const stream = client.messages.stream({
            model: anthropicModel,
            system,
            tools: tools as Anthropic.Tool[],
            messages: runningMessages,
            max_tokens: cfg.params.maxTokens,
            temperature: cfg.params.temperature,
            ...(cfg.params.topP != null ? { top_p: cfg.params.topP } : {}),
            ...(thinkingCfg ? { thinking: thinkingCfg } : {}),
          });

          const turn = await processStream(stream, send, onTextDelta);
          stopReason = turn.stopReason;

          // Record token usage. Anthropic bills thinking tokens in output_tokens.
          const t = tokens.record(turn.usage.input, turn.usage.output);
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

          // Persist assistant turn
          const assistantContent = turn.assistantTextParts.join('\n');
          if (assistantContent || turn.toolUseBlocks.length) {
            appendMessage(sess.id, {
              role: 'assistant',
              content: assistantContent,
              toolCalls: turn.toolUseBlocks.map(tb => ({ id: tb.id, name: tb.name, input: tb.input })),
              ts: Date.now(),
            });
          }

          // No tool calls → done
          if (turn.toolUseBlocks.length === 0 || stopReason === 'end_turn') {
            flushSentences(true);
            break;
          }

          // Flush any completed sentences before the tool call (so the user
          // sees prose complete before tool_call block appears)
          flushSentences(false);

          // Execute each tool_use (unchanged from the non-streaming path)
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
          for (const tb of turn.toolUseBlocks) {
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
              // Sanitize tool result text: strip ASCII control chars that would
              // break the next Anthropic turn (Anthropic rejects certain
              // control bytes in tool_result content).
              const safeText = result.text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
              toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: safeText });
              send({ type: 'tool_end', id: tb.id, name: tb.name, summary: safeText.slice(0, 200), durationMs: durMs });
            }
          }
          toolDepth++;

          // Build the next turn's messages array. We must include the
          // full assistant content (text + tool_use blocks) plus the tool
          // results. The full message object is available via
          // `stream.finalMessage()`.
          const finalMsg = await stream.finalMessage();
          runningMessages = [
            ...runningMessages,
            { role: 'assistant' as const, content: finalMsg.content as Anthropic.ContentBlockParam[] },
            { role: 'user' as const, content: toolResults },
          ];
        }

        send({ type: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Log server-side; send generic to client for 401/403
        console.error('[chat] error:', msg);
        if (msg.includes('budget_tokens') || msg.includes('thinking.budget_tokens')) {
          const need = cfg.params.thinkingLevel === 'off' ? 0 : THINKING_BUDGET[cfg.params.thinkingLevel] + 1;
          send({
            type: 'error',
            message: `thinking 配置与 max_tokens 冲突: ${msg}。请将 max_tokens 调到 ≥ ${need},或在调试参数中降级 thinkingLevel。`,
          });
        } else if (msg.includes('401') || msg.includes('authentication')) {
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
