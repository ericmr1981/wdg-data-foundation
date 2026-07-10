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

    // 1. 解析会话
    const conv = await this.deps.conversation.getOrCreate(msg)

    // 2. 加载历史
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)

    // 3. 工具集
    const tools = (await this.deps.mcpBridge.listTools())
      .filter((t: any) => isToolEnabled(t.name))
    tools.push({
      name: LOAD_SKILL_NAME,
      description: '加载 skill 完整内容',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
    } as any)

    // 4. system blocks(stable agentMd + cache_control ttl=1h)
    const system = buildSystemBlocks(cfg.agentMd)

    // 5. messages: session context + 历史 + 当前 user message
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
          this.recordAndSend(conv.conversationId, emitter, {
            type: 'message',
            payload: { message: finalMessage },
          } as any).catch(
            (e: Error) => console.error('[runner] recordAndSend final failed:', e),
          )
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
    } else {
      // ── 旧: 非流式 messages.create(env 旁路,R4 回退验证用) ──
      const response = await this.deps.anthropic.messages.create({
        model: cfg.model,
        max_tokens: cfg.params.maxTokens,
        system: system as any,
        tools: tools as any,
        messages,
        ...(thinkingCfg ?? {}),
      } as any, msg.signal ? { signal: msg.signal } : undefined)
      await this.recordAndSend(conv.conversationId, emitter, { type: 'message', payload: { message: response } } as any)
    }

    return { conversationId: conv.conversationId }
  }

  /**
   * I5 fix: 每条 emitter.send 之前落 agent.message_events(replay 端点用)。
   * recordEvent 内部 try/catch 静默失败,DB 故障不应拖垮流式输出。
   */
  private async recordAndSend(
    conversationId: string,
    emitter: EmitterLike,
    frame: any,
  ): Promise<void> {
    await this.deps.conversation.recordEvent(conversationId, frame.type, frame.payload)
    await emitter.send(frame)
  }
}
