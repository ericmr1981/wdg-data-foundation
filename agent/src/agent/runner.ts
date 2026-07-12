// agent/src/agent/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, thinkingConfigFor } from '../config/store.js'
import type { UnifiedMcpBridge } from '../mcp/bridge.js'
import type { ConversationManager, IncomingMsg } from '../conversation/manager.js'
import type { Notifier } from '../notifications/notifier.js'
import { initRegistry as _ } from '../skills/registry.js'  // trigger init
import { LOAD_SKILL_NAME } from '../skills/load-skill-tool.js'
import { isToolEnabled } from '../api/admin/tools.js'
import { buildSystemBlocks, buildSessionContextMessage } from './prompt.js'
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

export class AgentRunner {
  constructor(private deps: AgentRunnerDeps) {}

  async handle(
    msg: IncomingMsg,
    emitter: EmitterLike,
  ): Promise<{ conversationId: string; messageId?: string }> {
    const cfg = getAgentConfig()
    console.log('[runner] handle start convId=' + (msg.conversationId ?? 'null'))

    // 1. 解析会话
    const conv = await this.deps.conversation.getOrCreate(msg)
    console.log('[runner] getOrCreate done convId=' + conv.conversationId)

    // 2. 加载历史
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)
    console.log('[runner] getMessages done count=' + history.length)

    // 3. 持久化用户消息（仅当 Tool Runner 路径时；手动 tool loop 路径在下文独立处理）
    const isToolRunnerPath = process.env.RUNNER_USE_TOOL_RUNNER !== '0'
    if (isToolRunnerPath) {
      await this.deps.conversation.appendMessage({
        conversationId: conv.conversationId,
        role: 'user',
        content: msg.content,
      }).catch((e: Error) => console.error('[runner] appendMessage(user) failed:', e.message))
    }

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

    // 5. system blocks(stable agentMd + cache_control ttl=1h)
    const system = buildSystemBlocks(cfg.agentMd)

    // 6. messages: session context + 历史 + 当前 user message
    const userContent: any[] = []
    // session context 注入第一条 user 内容(不进 system,避免污染 cache)
    userContent.push({
      type: 'text',
      text: buildSessionContextMessage({
        today: new Date().toISOString().slice(0, 10),
        brand: msg.brand,
        conversationId: conv.conversationId,
        channel: msg.channelId,
      }),
    })
    // 用户真实内容:旧 IncomingMsg.content 是 string;R5 才切 ContentBlock[]
    if (typeof msg.content === 'string') {
      userContent.push({ type: 'text', text: msg.content })
    } else if (Array.isArray(msg.content)) {
      userContent.push(...(msg.content as any[]))
    }

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => {
        const c = m.content
        const content = typeof c === 'string' ? [{ type: 'text', text: c }] : c
        return { role: m.role as any, content: content as any }
      }),
      { role: 'user', content: userContent },
    ]

    // 6. thinking config(R2: {thinking, output_config} 整体 spread;off → null)
    const thinkingCfg = thinkingConfigFor(cfg.params.thinkingLevel)

    // 7. 调用 Tool Runner / messages.create(env 旁路)
    const useToolRunner = process.env.RUNNER_USE_TOOL_RUNNER !== '0'
    console.log('[runner] useToolRunner=' + useToolRunner + ' model=' + cfg.model)

    if (useToolRunner) {
      const iter = (this.deps.anthropic.beta.messages.toolRunner as any)(
        {
          model: cfg.model,
          max_tokens: cfg.params.maxTokens,
          system: system as any,
          tools: tools as any,
          messages: messages as any,
          stream: true,
          ...(thinkingCfg ?? {}),
        },
        msg.signal ? { signal: msg.signal } : undefined,
      )
      const stream = await (async () => {
        for await (const s of iter) return s as any
        throw new Error('toolRunner finished without yielding a stream')
      })()

      let finalAssistantContent = ''
      let finalToolCalls: any = null

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (err?: unknown) => {
          if (settled) return
          settled = true
          if (err) reject(err)
          else resolve()
        }

        stream.on('streamEvent', (event: any) => {
          const frame: any = { type: event.type, payload: event }
          this.recordAndSend(conv.conversationId, emitter, frame).catch(
            (e: Error) => console.error('[runner] recordAndSend failed:', e),
          )
        })

        stream.on('finalMessage', (finalMessage: any) => {
          this.recordAndSend(conv.conversationId, emitter, {
            type: 'message',
            payload: finalMessage,
          } as any).catch(
            (e: Error) => console.error('[runner] recordAndSend final failed:', e),
          )
          finalAssistantContent = extractTextContent(finalMessage)
          finalToolCalls = extractToolCalls(finalMessage)
        })

        stream.on('error', (err: any) => {
          finish(err)
        })

        stream.on('aborted', () => {
          finish()
        })

        stream.on('end', () => finish())
      })

      if (finalAssistantContent || finalToolCalls) {
        this.deps.conversation.appendMessage({
          conversationId: conv.conversationId,
          role: 'assistant',
          content: finalAssistantContent,
          toolCalls: finalToolCalls,
        }).catch((e: Error) => console.error('[runner] appendMessage(assistant) failed:', e.message))
      }
    } else {
      // ── 手动 tool loop + 模拟流式推送 ──
      console.log('[runner] starting manual tool loop, model=' + cfg.model)
      const MAX_TOOL_TURNS = 10
      const loopMessages = [...messages] as any[]

      const emitFrame = async (frame: any, delayMs = 5) => {
        await this.recordAndSend(conv.conversationId, emitter, frame)
        if (delayMs > 0) await sleep(delayMs)
      }

      const emitResponseStreaming = async (response: any, toolResults?: any[]) => {
        const msgId = response.id
        const blocks = (response.content || []) as any[]
        const allBlocks = toolResults ? [...blocks, ...toolResults] : blocks

        await emitFrame({
          type: 'message_start',
          payload: {
            message: {
              id: msgId, type: 'message', role: 'assistant',
              model: response.model, content: [], stop_reason: null,
            },
          },
        }, 10)

        for (let i = 0; i < allBlocks.length; i++) {
          const block = allBlocks[i]

          if (block.type === 'text') {
            await emitFrame({
              type: 'content_block_start',
              payload: { index: i, content_block: { type: 'text', text: '' } },
            }, 10)

            const text = block.text as string
            const CHUNK = 3
            for (let pos = 0; pos < text.length; pos += CHUNK) {
              const chunk = text.slice(pos, pos + CHUNK)
              await emitFrame({
                type: 'content_block_delta',
                payload: { index: i, delta: { type: 'text_delta', text: chunk } },
              }, 18)
            }

            await emitFrame({
              type: 'content_block_stop', payload: { index: i },
            }, 5)
          } else if (block.type === 'thinking') {
            await emitFrame({
              type: 'content_block_start',
              payload: { index: i, content_block: { type: 'thinking', thinking: block.thinking } },
            }, 10)
            await emitFrame({
              type: 'content_block_stop', payload: { index: i },
            }, 5)
          } else if (block.type === 'tool_use') {
            await emitFrame({
              type: 'content_block_start',
              payload: {
                index: i,
                content_block: {
                  type: 'tool_use', id: (block as any).id,
                  name: (block as any).name, input: undefined, inputRaw: '',
                },
              },
            }, 15)

            const inputJson = JSON.stringify((block as any).input ?? {}, null, 2)
            for (let pos = 0; pos < inputJson.length; pos += 8) {
              await emitFrame({
                type: 'content_block_delta',
                payload: {
                  index: i,
                  delta: { type: 'input_json_delta', partial_json: inputJson.slice(pos, pos + 8) },
                },
              }, 5)
            }

            await emitFrame({
              type: 'content_block_stop', payload: { index: i },
            }, 10)
          } else if (block.type === 'tool_result') {
            await emitFrame({
              type: 'content_block_start',
              payload: { index: i, content_block: block },
            }, 10)
            await emitFrame({
              type: 'content_block_stop', payload: { index: i },
            }, 5)
          }
        }

        await emitFrame({
          type: 'message_delta',
          payload: {
            delta: { stop_reason: response.stop_reason ?? null },
            usage: response.usage,
          },
        }, 5)
        await emitFrame({
          type: 'message_stop', payload: {},
        }, 5)
      }

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        console.log('[runner] tool loop turn ' + (turn + 1) + '/' + MAX_TOOL_TURNS)

        const response = await this.deps.anthropic.messages.create({
          model: cfg.model,
          max_tokens: cfg.params.maxTokens,
          system: system as any,
          tools: tools as any,
          messages: loopMessages,
          ...(thinkingCfg ?? {}),
        } as any, msg.signal ? { signal: msg.signal } : undefined)

        console.log('[runner] turn ' + (turn + 1) + ' stop_reason=' + (response.stop_reason ?? '?'))

        const toolUses = (response.content || []).filter((c: any) => c.type === 'tool_use')

        if (toolUses.length > 0) {
          console.log('[runner] turn ' + (turn + 1) + ' has ' + toolUses.length + ' tool_use(s)')

          loopMessages.push({
            role: 'assistant',
            content: (response.content || []).map((c: any) => ({ ...c })),
          } as any)

          const toolResults: any[] = []
          for (const tu of toolUses) {
            const toolName = (tu as any).name as string
            const toolInput = (tu as any).input || {}
            console.log('[runner] calling tool: ' + toolName)

            let resultContent: string
            let isError = false
            try {
              const result = await this.deps.mcpBridge.call(toolName, toolInput)
              resultContent = result.success
                ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2))
                : 'MCP error: ' + (result.error || 'unknown')
              isError = !result.success
            } catch (e: any) {
              resultContent = 'Tool call failed: ' + (e?.message ?? String(e))
              isError = true
            }

            const MAX_RESULT_LEN = 16000
            if (resultContent.length > MAX_RESULT_LEN) {
              resultContent = resultContent.slice(0, MAX_RESULT_LEN) + '\n…(truncated)'
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: (tu as any).id as string,
              content: resultContent,
              is_error: isError,
            })
          }

          loopMessages.push({ role: 'user', content: toolResults } as any)

          await emitResponseStreaming(response, toolResults)
          continue
        }

        // 无 tool_use → 最终 text 回复
        await emitResponseStreaming(response)

        const finalText = extractTextContent(response)
        await this.deps.conversation.appendMessage({
          conversationId: conv.conversationId,
          role: 'assistant',
          content: finalText,
          toolCalls: null,
        }).catch((e: Error) => console.error('[runner] appendMessage(assistant) failed:', e.message))
        break
      }

      console.log('[runner] tool loop done')

      const prevMsgCount = history.length
      await this.deps.conversation.appendMessage({
        conversationId: conv.conversationId,
        role: 'user',
        content: msg.content,
      }).catch((e: Error) => console.error('[runner] appendMessage(user) failed:', e.message))

      for (let i = prevMsgCount; i < loopMessages.length; i++) {
        const m = loopMessages[i]
        if (m.role === 'user') continue
        if (m.role === 'assistant') {
          const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]
          const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          const toolCalls = blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
          await this.deps.conversation.appendMessage({
            conversationId: conv.conversationId,
            role: 'assistant',
            content: text || '(tool calls)',
            toolCalls: toolCalls.length > 0 ? toolCalls : null,
          }).catch((e: Error) => console.error('[runner] appendMessage(assistant) failed:', e.message))
        }
      }
    }

    return { conversationId: conv.conversationId }
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

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

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
