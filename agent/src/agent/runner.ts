// agent/src/agent/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, thinkingConfigFor } from '../config/store.js'
import type { UnifiedMcpBridge } from '../mcp/bridge.js'
import type { ConversationManager, IncomingMsg } from '../conversation/manager.js'
import type { Notifier } from '../notifications/notifier.js'
import { initRegistry as _ } from '../skills/registry.js'  // trigger init
import { LOAD_SKILL_NAME, handleLoadSkill } from '../skills/load-skill-tool.js'
import { isToolEnabled } from '../api/admin/tools.js'
import { buildSystemBlocks, buildSessionContextMessage } from './prompt.js'
import { reconstructContentBlocks } from '../conversation/content-blocks.js'
import type { ChatEmitter } from '../channels/chat-emitter.js'

export interface RunnerStep {
  phase: 'thinking' | 'tool_call' | 'tool_result' | 'persisted' | 'complete'
  label: string
  tool?: string
  toolName?: string
  ok?: boolean
  ts: number
}

export interface AgentRunnerDeps {
  anthropic: Anthropic
  mcpBridge: UnifiedMcpBridge
  conversation: ConversationManager
  notifier: Notifier
}

/** emitter 只需要 send() — 生产用 ChatEmitter,测试/其它渠道可传等价 shape */
type EmitterLike = ChatEmitter | { send: (f: any) => Promise<void> }

/** LLM 调用的 tool loop 上限(防无限循环) */
const MAX_TOOL_TURNS = 10

/** 单个 tool_result 返回内容大小上限(超过截断) */
const MAX_RESULT_LEN = 16000

/** 60s 内无任何 streamEvent → 判定 LLM 无响应 */
const LLM_TIMEOUT_MS = 60_000

interface RunStreamedLoopCtx {
  cfg: ReturnType<typeof getAgentConfig>
  conv: { conversationId: string }
  system: any[]
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
  historyLength: number
  thinkingCfg: any | null
  signal?: AbortSignal
}

export class AgentRunner {
  private _globalToolCallCount = new Map<string, number>()
  constructor(private deps: AgentRunnerDeps) {}

  async handle(
    msg: IncomingMsg,
    emitter: EmitterLike,
  ): Promise<{ conversationId: string; messageId?: string }> {
    const cfg = getAgentConfig()
    console.log('[runner] handle start convId=' + (msg.conversationId ?? 'null'))

    // Reset per-conversation tool call dedup counter
    this._globalToolCallCount.clear()

    // 1. 解析会话
    const conv = await this.deps.conversation.getOrCreate(msg)
    console.log('[runner] getOrCreate done convId=' + conv.conversationId)

    // 2. 加载历史
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)
    console.log('[runner] getMessages done count=' + history.length)

    // 3. 持久化用户消息
    await this.deps.conversation.appendMessage({
      conversationId: conv.conversationId,
      role: 'user',
      content: msg.content,
    }).catch((e: Error) => console.error('[runner] appendMessage(user) failed:', e.message))

    // 4. 工具集
    console.log('[runner] listTools start...')
    const tools = (await this.deps.mcpBridge.listTools())
      .filter((t: any) => isToolEnabled(t.name))
      .map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: sanitizeJsonSchema(t.inputSchema ?? {}),
      }))
    console.log('[runner] listTools done count=' + tools.length)
    tools.push({
      name: LOAD_SKILL_NAME,
      description: '加载 skill 完整内容',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
    } as any)

    // 5. system blocks
    const system = buildSystemBlocks(cfg.agentMd)

    // 6. messages: session context + 历史 + 当前 user message
    const userContent: any[] = []
    userContent.push({
      type: 'text',
      text: buildSessionContextMessage({
        today: new Date().toISOString().slice(0, 10),
        brand: msg.brand,
        conversationId: conv.conversationId,
        channel: msg.channelId,
      }),
    })
    if (typeof msg.content === 'string') {
      userContent.push({ type: 'text', text: msg.content })
    } else if (Array.isArray(msg.content)) {
      userContent.push(...(msg.content as any[]))
    }

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => {
        const blocks = reconstructContentBlocks({
          content: m.content,
          tool_calls: (m as any).toolCalls,
          tool_results: (m as any).toolResults,
          thinking: (m as any).thinking ?? null,
        })
        return { role: m.role as any, content: blocks as any }
      }),
      { role: 'user', content: userContent },
    ]

    // 7. thinking config
    const thinkingCfg = thinkingConfigFor(cfg.params.thinkingLevel)

    // 8. 调用 LLM (单条路径: client.messages.stream + 自管 tool loop)
    //    走 POST /v1/messages 标准路径 — 真 Anthropic / MiniMax / DeepSeek 兼容端点全支持
    console.log('[runner] starting streamed manual loop, model=' + cfg.model)
    const ctx: RunStreamedLoopCtx = {
      cfg, conv, system, tools, messages,
      historyLength: history.length,
      thinkingCfg,
      signal: msg.signal,
    }
    try {
      await this.runStreamedLoop(msg, emitter, ctx)
    } catch (err: any) {
      console.error('[runner] streamed loop error:', err?.message ?? String(err))
      await this.sendError(conv.conversationId, emitter,
        err?.message ?? '未知错误',
      ).catch(() => {})
    }

    return { conversationId: conv.conversationId }
  }

  /**
   * 流式 tool loop: 每一轮用 client.messages.stream 调 LLM,自己管理 tool_use → tool_result 循环。
   * 兼容真 Anthropic (api.anthropic.com) 以及 MiniMax/DeepSeek 这类第三方兼容端点
   * (它们实现了 /v1/messages 标准路径,但 client.beta.messages.* 的 ?beta=true 路径未实现)。
   */
  private async runStreamedLoop(
    msg: IncomingMsg,
    emitter: EmitterLike,
    ctx: RunStreamedLoopCtx,
  ): Promise<void> {
    const loopMessages = [...ctx.messages] as any[]

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      console.log('[runner] tool loop turn ' + (turn + 1) + '/' + MAX_TOOL_TURNS)

      // 0. 检查 abort 信号
      if (ctx.signal?.aborted) {
        console.log('[runner] aborted before turn ' + (turn + 1))
        return
      }

      // 1. 开流
      const stream = this.deps.anthropic.messages.stream(
        {
          model: ctx.cfg.model,
          max_tokens: ctx.cfg.params.maxTokens,
          system: ctx.system as any,
          tools: ctx.tools as any,
          messages: loopMessages,
          ...(ctx.thinkingCfg ?? {}),
        } as any,
        ctx.signal ? { signal: ctx.signal } : undefined,
      )

      // 2. 订阅 streamEvent,把 SDK 的 SSE 事件实时转发给 client
      //    同时给每个 text block 的 content_block_stop 之后补发一个 text_block 帧
      //    (UI ChatWidget 只认 text_block,不认 content_block_delta)
      let streamStarted = false
      let stopReason: string | null = null
      let messageId = ''
      // 用于在 content_block_stop 时,知道是哪个 index 收尾
      const partialTextByIndex = new Map<number, string>()
      const partialInputByIndex = new Map<number, string>()

      const timeoutTimer = setTimeout(async () => {
        if (streamStarted) return
        console.error('[runner] LLM timeout — no stream events for ' + LLM_TIMEOUT_MS + 'ms')
        await this.sendError(ctx.conv.conversationId, emitter,
          'LLM 在 ' + (LLM_TIMEOUT_MS / 1000) + 's 内未响应,正在诊断连接...')
        const diag = await this.diagnoseLlmConnection(ctx.cfg.model)
        await this.sendError(ctx.conv.conversationId, emitter,
          'LLM 连接诊断完成: ' + (diag.ok
            ? '连接正常,超时可能是模型负载高 (' + diag.detail + ')'
            : '连接失败: ' + diag.detail),
        )
        // 让外层 try/catch 收尾
        stream.controller.abort()
      }, LLM_TIMEOUT_MS)

      const wirePromise = new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (err?: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutTimer)
          if (err) reject(err)
          else resolve()
        }

        stream.on('streamEvent', (event: any) => {
          streamStarted = true
          clearTimeout(timeoutTimer)
          // 转发 raw SSE event
          this.recordAndSend(ctx.conv.conversationId, emitter, {
            type: event.type,
            payload: event,
          }).catch((e: Error) => console.error('[runner] recordAndSend failed:', e))

          if (event.type === 'message_start') {
            const m = event.message || {}
            messageId = m.id || ''
          } else if (event.type === 'content_block_start') {
            const idx = event.index as number
            const cb = event.content_block
            if (cb?.type === 'text') partialTextByIndex.set(idx, '')
            else if (cb?.type === 'tool_use') partialInputByIndex.set(idx, '')
          } else if (event.type === 'content_block_delta') {
            const idx = event.index as number
            const delta = event.delta || {}
            if (delta.type === 'text_delta' && partialTextByIndex.has(idx)) {
              partialTextByIndex.set(idx, (partialTextByIndex.get(idx) || '') + delta.text)
            } else if (delta.type === 'input_json_delta' && partialInputByIndex.has(idx)) {
              partialInputByIndex.set(idx, (partialInputByIndex.get(idx) || '') + (delta.partial_json || ''))
            }
          } else if (event.type === 'content_block_stop') {
            const idx = event.index as number
            if (partialTextByIndex.has(idx)) {
              // text 块收尾 → 立刻补发一个 text_block 帧(UI ChatWidget 只认这个)
              this.recordAndSend(ctx.conv.conversationId, emitter, {
                type: 'text_block',
                payload: { index: idx, text: partialTextByIndex.get(idx) || '', turnId: messageId },
              }).catch((e: Error) => console.error('[runner] text_block emit failed:', e))
              partialTextByIndex.delete(idx)
            }
            partialInputByIndex.delete(idx)
          } else if (event.type === 'message_delta') {
            stopReason = event.delta?.stop_reason ?? null
          } else if (event.type === 'message_stop') {
            finish()
          }
        })

        stream.on('error', async (err: any) => {
          clearTimeout(timeoutTimer)
          await this.sendError(ctx.conv.conversationId, emitter,
            'LLM 流错误: ' + (err?.message ?? String(err)),
          ).catch(() => {})
          finish(err)
        })

        stream.on('abort', async () => {
          clearTimeout(timeoutTimer)
          await this.recordAndSend(ctx.conv.conversationId, emitter, {
            type: 'interrupted',
            payload: { conversationId: ctx.conv.conversationId, reason: 'user_interrupt' },
          }).catch((e: Error) => console.error('[runner] recordAndSend(interrupted) failed:', e))
          console.log('[runner] stream aborted (user interrupt)')
          finish()
        })

        stream.on('end', () => {
          clearTimeout(timeoutTimer)
          finish()
        })
      })

      try {
        await wirePromise
      } catch (err: any) {
        // error frame 已在 'error' handler 里发过,直接退出循环
        console.error('[runner] stream error path:', err?.message ?? String(err))
        return
      }

      // 3. 拿最终 message(SDK 已组装好 content blocks,tool_use.input 是解析后的 JSON)
      let finalMessage: any
      try {
        finalMessage = await stream.finalMessage()
      } catch (err: any) {
        // finalMessage 在 error 后会 reject — 已经处理过 error frame,直接退出
        console.error('[runner] finalMessage rejected:', err?.message ?? String(err))
        return
      }

      stopReason = finalMessage.stop_reason ?? stopReason
      console.log('[runner] turn ' + (turn + 1) + ' stop_reason=' + (stopReason ?? '?'))

      const toolUses = (finalMessage.content || []).filter((c: any) => c.type === 'tool_use')

      if (toolUses.length > 0) {
        console.log('[runner] turn ' + (turn + 1) + ' has ' + toolUses.length + ' tool_use(s)')

        // 工具调用回合:把整轮 assistant message 推进 loopMessages,然后逐个跑工具
        loopMessages.push({
          role: 'assistant',
          content: (finalMessage.content || []).map((c: any) => ({ ...c })),
        } as any)

        const toolResults: any[] = []
        for (const tu of toolUses) {
          const toolName = (tu as any).name as string
          const toolInput = (tu as any).input || {}

          // Limit repeated calls to the same tool (max 2 per conversation turn loop)
          const globalCount = this._globalToolCallCount.get(toolName) ?? 0
          if (globalCount >= 2) {
            console.log(`[runner] tool "${toolName}" already called ${globalCount}x, skipping`)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: (tu as any).id as string,
              content: `Tool "${toolName}" has already been called ${globalCount} times in this conversation. Do not call it again — use the previous result or try a different approach.`,
              is_error: false,
            })
            continue
          }

          this._globalToolCallCount.set(toolName, globalCount + 1)
          console.log(`[runner] calling tool: ${toolName} (call #${globalCount + 1})`)

          let resultContent: string
          let isError = false
          try {
            if (toolName === LOAD_SKILL_NAME) {
              const loadResult = handleLoadSkill(toolInput)
              resultContent = loadResult.content
              isError = loadResult.content.startsWith('ERROR:')
            } else {
              const result = await this.deps.mcpBridge.call(toolName, toolInput)
              resultContent = result.success
                ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2))
                : 'MCP error: ' + (result.error || 'unknown')
              isError = !result.success
            }
          } catch (e: any) {
            resultContent = 'Tool call failed: ' + (e?.message ?? String(e))
            isError = true
          }

          if (resultContent.length > MAX_RESULT_LEN) {
            resultContent = resultContent.slice(0, MAX_RESULT_LEN) + '\n…(truncated)'
          }

          // 通知 client 当前 tool 跑完了(给 /api/admin/test-run 用)
          this.recordAndSend(ctx.conv.conversationId, emitter, {
            type: 'tool_result',
            payload: {
              tool_use_id: (tu as any).id,
              tool_name: toolName,
              is_error: isError,
              content_preview: resultContent.slice(0, 800),
            },
          }).catch((e: Error) => console.error('[runner] tool_result frame failed:', e))

          toolResults.push({
            type: 'tool_result',
            tool_use_id: (tu as any).id as string,
            content: resultContent,
            is_error: isError,
          })
        }

        loopMessages.push({ role: 'user', content: toolResults } as any)
        continue
      }

      // 无 tool_use → 最终 text 回复
      const finalText = extractTextContent(finalMessage)
      await this.deps.conversation.appendMessage({
        conversationId: ctx.conv.conversationId,
        role: 'assistant',
        content: finalText,
        toolCalls: extractToolCalls(finalMessage),
      }).catch((e: Error) => console.error('[runner] appendMessage(assistant) failed:', e.message))
      break
    }

    console.log('[runner] tool loop done')

    // 历史回放持久化:把中间轮(被 push 进 loopMessages 但未单独持久化的)补写。
    // 必须把 assistant 的 tool_use 和 user 的 tool_result 都写,否则下一轮 LLM 看到
    // 没有 tool_result 的 tool_use 会 400 "tool call result does not follow tool call"。
    for (let i = ctx.historyLength; i < loopMessages.length; i++) {
      const m = loopMessages[i]
      if (m.role === 'assistant') {
        const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]
        const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        const toolCalls = blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
        await this.deps.conversation.appendMessage({
          conversationId: ctx.conv.conversationId,
          role: 'assistant',
          content: text || '(tool calls)',
          toolCalls: toolCalls.length > 0 ? toolCalls : null,
        }).catch((e: Error) => console.error('[runner] appendMessage(assistant history) failed:', e.message))
      } else if (m.role === 'user' && Array.isArray(m.content)) {
        // user message 包含 tool_result blocks → 把 tool_results 写进 DB
        const toolResults = m.content.filter((b: any) => b.type === 'tool_result')
        if (toolResults.length > 0) {
          await this.deps.conversation.appendMessage({
            conversationId: ctx.conv.conversationId,
            role: 'user',
            content: '',
            toolResults,
          }).catch((e: Error) => console.error('[runner] appendMessage(tool_result history) failed:', e.message))
        }
      }
    }
  }

  private async sendError(
    conversationId: string,
    emitter: EmitterLike,
    message: string,
  ): Promise<void> {
    await this.recordAndSend(conversationId, emitter, {
      type: 'error',
      payload: { message },
    })
  }

  private async diagnoseLlmConnection(model: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const ping = await this.deps.anthropic.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      } as any, { signal: AbortSignal.timeout(15_000) })
      const stopReason = (ping as any).stop_reason ?? '?'
      return { ok: true, detail: 'model=' + model + ' stop_reason=' + stopReason }
    } catch (err: any) {
      return { ok: false, detail: err?.message ?? String(err) }
    }
  }

  private async recordAndSend(
    conversationId: string,
    emitter: EmitterLike,
    frame: any,
  ): Promise<void> {
    await emitter.send(frame)
    this.deps.conversation.recordEvent(conversationId, frame.type, frame.payload)
      .catch((e: Error) => console.error('[runner] recordEvent failed (silent):', e?.message ?? e))
  }
}

/**
 * 递归清理 JSON Schema 中不被某些 LLM API 接受的属性。
 * - 移除 `nullable: true` → 改为 anyOf
 * - 确保 `type` 字段存在
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema)

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    // Recursively clean nested schemas
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cleaned: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        cleaned[propName] = sanitizeJsonSchema(propSchema)
      }
      out[key] = cleaned
    } else if ((key === 'items' || key === 'additionalProperties' || key === 'contains') && value && typeof value === 'object') {
      out[key] = sanitizeJsonSchema(value)
    } else if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      out[key] = Array.isArray(value) ? value.map(sanitizeJsonSchema) : value
    } else if (key === 'nullable') {
      // Drop nullable — not supported by DeepSeek / MiniMax
      // already handled by stripping it
    } else {
      out[key] = value
    }
  }

  // Ensure type field exists for object schemas with properties
  if (out.properties && !out.type && !out.anyOf && !out.oneOf && !out.allOf) {
    out.type = 'object'
  }

  return out
}

function extractTextContent(msg: any): string {
  if (!msg?.content) return ''
  const blocks = Array.isArray(msg.content) ? msg.content : []
  return blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
}

function extractToolCalls(msg: any): any[] | null {
  if (!msg?.content) return null
  const blocks = Array.isArray(msg.content) ? msg.content : []
  const calls = blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
  return calls.length > 0 ? calls : null
}