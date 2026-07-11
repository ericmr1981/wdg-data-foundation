// agent/src/agent/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, thinkingConfigFor } from '../config/store.js'
import type { McpBridge } from '../mcp/bridge.js'
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
  mcpBridge: McpBridge
  conversation: ConversationManager
  notifier: Notifier
}

/** emitter 只需要 send() — 生产用 ChatEmitter,测试/其它渠道可传等价 shape */
type EmitterLike = ChatEmitter | { send: (f: any) => Promise<void> }

export class AgentRunner {
  constructor(private deps: AgentRunnerDeps) {}

  /**
   * 处理一条 user.message(来自 web WS、cron、或 admin test)。
   * R4 (Phase 1b): 内部机制换成 anthropic.beta.messages.toolRunner({stream:true}),
   * 由 SDK 自动管 tool_use / pause_turn / end_turn。本 task 仍把每个 message 整体
   * 回推给 emitter,逐 frame 透传留 R5。
   *
   * env RUNNER_USE_TOOL_RUNNER=0 → 走旧的非流式 messages.create(回退旁路)。
   */
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
      // ── 新 (post-fix-list 2026-07-10): Tool Runner 流式 → SDK 原生事件透传 ──
      //
      // R4 时误把 `for await (const x of iter)` 拿到的对象当成 Anthropic.Message emit;
      // 实际 `stream: true` 时 SDK 返回的是 BetaMessageStream(EventEmitter+async iterable),
      // 那个对象 .messages / .receivedMessages / .controller 才是 portal 早先看到的内部状态。
      //
      // Spec §A.2.3 streaming variant 解法:订阅 BetaMessageStream 的 'streamEvent' 事件,
      // 把每个 SDK 原生事件 *原本*映射成 spec-chat-agent.md §A.3 的 ChatOutgoing 帧:
      //   SDK raw event name          →  spec frame type
      //   ──────────────────────────────────────────────────
      //   message_start               →  message_start       { message }
      //   content_block_start         →  content_block_start { index, content_block }
      //   content_block_delta          →  content_block_delta  { index, delta }
      //   content_block_stop          →  content_block_stop  { index }
      //   message_delta               →  message_delta       { delta, usage? }
      //   message_stop                →  message_stop        {}
      //
      // 结束时 (await finalMessage) 一次性 emit `message` 给需要 final payload 的 caller,
      // 但实际 portal 消费的是上面 6 个 SDK event,所以 `message` 帧可选。
      //
      // R6 (Phase 2) abort signal 接 BetaToolRunnerRequestOptions 第二参(SDK 0.110+ signature)。
      // R7 (Phase 3) recordAndSend:每个 emit 前先 recordEvent 持久化到 agent.message_events。
      // toolRunner 自带 Symbol.asyncIterator (per BetaToolRunner.d.ts) — for-await 解构
      // 一次来抽 BetaMessageStream;iter 是 toolRunner 自身的 iterator。
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
      // 取第一次 yield 拿 BetaMessageStream 实例;tollRunner 自己管内部多轮迭代,
      // 我们只关心它的第一份 stream(后续 iter 循环由 SDK 内部消费,见 BetaToolRunner.mjs)。
      const stream = await (async () => {
        for await (const s of iter) return s as any
        throw new Error('toolRunner finished without yielding a stream')
      })()

      // R7 fix: 变量提升到 Promise scope 外，finalMessage 回调赋值，Promise resolve 后持久化
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
          // BetaMessageStreamEvent 形状: { type: 'message_start' | 'content_block_start' | ... ,
          //   message?, index?, content_block?, delta?, usage?, ... }
          // spec-chat-agent.md §A.3 帧 type 与 SDK event type 同名,
          // payload 直接透传 SDK event(payload 内字段名已是 spec 要求的)。
          const frame: any = { type: event.type, payload: event }
          this.recordAndSend(conv.conversationId, emitter, frame).catch(
            (e: Error) => console.error('[runner] recordAndSend failed:', e),
          )
        })

        stream.on('finalMessage', (finalMessage: any) => {
          // portal 可选消费 'message' 帧(完整 final payload);与 6 帧并存的语义是 final 汇总。
          // ChatShell reducer 直接访问 payload.id / .content / .stop_reason / .usage,
          // 不加 { message: ... } 包装(与 SDK event 的 message_start 格式对齐)。
          this.recordAndSend(conv.conversationId, emitter, {
            type: 'message',
            payload: finalMessage,
          } as any).catch(
            (e: Error) => console.error('[runner] recordAndSend final failed:', e),
          )
          // 捕获助手回复内容用于持久化
          finalAssistantContent = extractTextContent(finalMessage)
          finalToolCalls = extractToolCalls(finalMessage)
        })

        stream.on('error', (err: any) => {
          // 跟 R5/§A.2.5 一致:catch SDK typed exception → 发 error 帧
          // 但 emit 已在外面 await finalMessage,错误就转 throw 给 caller。
          finish(err)
        })

        stream.on('aborted', () => {
          // R6 user.interrupt 触发 ac.abort() → SDK stream abort;
          // 已发 'interrupted' 帧在 web.ts;这里 noop。
          finish()
        })

        stream.on('end', () => finish())
      })

      // R7 fix: 持久化助手回复到 agent.messages，确保下次 getMessages() 能加载历史
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
      // 非流式 messages.create 拿回完整 response,拆成 6 帧协议逐帧推送:
      //   message_start → content_block_start → delta(分段) → content_block_stop
      //   → …(tool execution)… → message_delta → message_stop
      // Portal 侧 ChatShell reducer 逐帧消费,UI 逐块渲染。
      console.log('[runner] starting manual tool loop, model=' + cfg.model)
      const MAX_TOOL_TURNS = 10
      const loopMessages = [...messages] as any[]

      const emitFrame = async (frame: any, delayMs = 5) => {
        await this.recordAndSend(conv.conversationId, emitter, frame)
        if (delayMs > 0) await sleep(delayMs)
      }

      /**
       * 把一条完整的 LLM response 拆成流式帧序列推送。
       * toolResults 可选: 含 tool_use 的 turn 把 tool_result blocks 追加到同一条消息末尾。
       */
      const emitResponseStreaming = async (response: any, toolResults?: any[]) => {
        const msgId = response.id
        const blocks = (response.content || []) as any[]
        const allBlocks = toolResults ? [...blocks, ...toolResults] : blocks

        // 1. message_start — Portal 侧创建新的 streaming ChatMessage
        await emitFrame({
          type: 'message_start',
          payload: {
            message: {
              id: msgId, type: 'message', role: 'assistant',
              model: response.model, content: [], stop_reason: null,
            },
          },
        }, 10)

        // 2. 逐 block 推送
        for (let i = 0; i < allBlocks.length; i++) {
          const block = allBlocks[i]

          if (block.type === 'text') {
            // content_block_start: 先放空 text,Portal 侧会创建 Markdown 区域
            await emitFrame({
              type: 'content_block_start',
              payload: { index: i, content_block: { type: 'text', text: '' } },
            }, 10)

            // 逐 chunk 推送 delta,模拟打字效果
            const text = block.text as string
            const CHUNK = 3  // 每次 3 个字符,更平滑的打字效果
            for (let pos = 0; pos < text.length; pos += CHUNK) {
              const chunk = text.slice(pos, pos + CHUNK)
              await emitFrame({
                type: 'content_block_delta',
                payload: { index: i, delta: { type: 'text_delta', text: chunk } },
              }, 18)  // ~167 chars/s, 更慢更自然
            }

            await emitFrame({
              type: 'content_block_stop', payload: { index: i },
            }, 5)
          } else if (block.type === 'thinking') {
            // thinking 块: Portal 渲染为可折叠面板,一次性推送完整内容
            await emitFrame({
              type: 'content_block_start',
              payload: { index: i, content_block: { type: 'thinking', thinking: block.thinking } },
            }, 10)
            await emitFrame({
              type: 'content_block_stop', payload: { index: i },
            }, 5)
          } else if (block.type === 'tool_use') {
            // tool_use 块: 先展示工具头(名称+id),再逐段展示输入 JSON
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

        // 3. message_delta + message_stop → Portal 标记消息为 done
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

      // ── Tool loop ──
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

          // 深拷贝存入对话历史
          loopMessages.push({
            role: 'assistant',
            content: (response.content || []).map((c: any) => ({ ...c })),
          } as any)

          // 执行工具调用
          const toolResults: any[] = []
          for (const tu of toolUses) {
            const toolName = (tu as any).name as string
            const toolInput = (tu as any).input || {}
            console.log('[runner] calling tool: ' + toolName)

            let resultContent: string
            let isError = false
            try {
              const result = await this.deps.mcpBridge.call(toolName, toolInput, msg.userId)
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

          // 流式推送本 turn: thinking + tool_use + tool_result 依次出现
          await emitResponseStreaming(response, toolResults)
          continue
        }

        // 无 tool_use → 最终 text 回复
        await emitResponseStreaming(response)
        break
      }

      console.log('[runner] tool loop done')

      // R7 fix: 持久化本次新增的消息到 agent.messages
      // loopMessages = history(前 history.length 条) + userMsg + assistant turns + tool_results
      // 只持久化索引 >= history.length 的新消息，避免重复写入历史
      const prevMsgCount = history.length
      // 第一步：持久化原始用户输入（不在 loopMessages 里取，避免 Session Context 污染）
      await this.deps.conversation.appendMessage({
        conversationId: conv.conversationId,
        role: 'user',
        content: msg.content,
      }).catch((e: Error) => console.error('[runner] appendMessage(user) failed:', e.message))

      // 第二步：遍历 loopMessages 只取 assistant 和 tool_result 新增部分
      for (let i = prevMsgCount; i < loopMessages.length; i++) {
        const m = loopMessages[i]
        if (m.role === 'user') {
          // 用户消息已在上一步单独持久化，跳过（loopMessages 里 user 含 Session Context）
          continue
        }
        if (m.role === 'assistant') {
          const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]
          const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          const toolCalls = blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
          // 即使 text 为空也要存（纯 tool_use 轮次），否则 getMessages 还原时丢失 assistant turn
          await this.deps.conversation.appendMessage({
            conversationId: conv.conversationId,
            role: 'assistant',
            content: text || '(tool calls)',  // 标记纯 tool 轮次，非空字符串确保不会被过滤
            toolCalls: toolCalls.length > 0 ? toolCalls : null,
          }).catch((e: Error) => console.error('[runner] appendMessage(assistant) failed:', e.message))
        }
        // tool_result 由 assistent 的 toolCalls 字段隐式携带，不单独存
      }
    }

    return { conversationId: conv.conversationId }
  }

  /**
   * 顺序: 先 emit 帧给 client(实时 UI 优先),再 recordEvent 写 DB(replay 端点)。
   * recordEvent 失败(DB 缺表 / DB down) 静默吞掉,不影响流式体验。
   * Portal 调试经验: 一旦 recordEvent 失败,UI 看不到任何 frame(整个 emit 被 catch 吞)。
   */
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

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

/** Extract plain text from an Anthropic Message's content blocks. */
function extractTextContent(msg: any): string {
  if (!msg?.content) return ''
  const blocks = Array.isArray(msg.content) ? msg.content : []
  return blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
}

/** Extract tool_use blocks from an Anthropic Message's content. */
function extractToolCalls(msg: any): any[] | null {
  if (!msg?.content) return null
  const blocks = Array.isArray(msg.content) ? msg.content : []
  const calls = blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
  return calls.length > 0 ? calls : null
}
