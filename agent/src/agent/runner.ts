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
      // ── 新: Tool Runner 流式 ──
      // R6 (Phase 2): pass abort signal via options (second arg) — that's where
      // BetaToolRunnerRequestOptions lives in SDK 0.110+. user.interrupt triggers
      // ac.abort() in web.ts; SDK throws AbortError; token usage stops.
      const iter = this.deps.anthropic.beta.messages.toolRunner(
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
      for await (const message of iter) {
        await emitter.send({ type: 'message', payload: { message } } as any)
      }
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
      await emitter.send({ type: 'message', payload: { message: response } } as any)
    }

    return { conversationId: conv.conversationId }
  }
}
