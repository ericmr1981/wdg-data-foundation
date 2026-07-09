// agent/src/agent/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, thinkingConfigFor } from '../config/store.js'
import type { McpBridge } from '../mcp/bridge.js'
import type { ConversationManager, IncomingMsg } from '../conversation/manager.js'
import type { Notifier } from '../notifications/notifier.js'
import { initRegistry as _ } from '../skills/registry.js'  // trigger init
import { handleLoadSkill, LOAD_SKILL_NAME } from '../skills/load-skill-tool.js'
import { isToolEnabled } from '../api/admin/tools.js'
import { buildSystemPrompt } from './prompt.js'
import { LlmError, mapAnthropicError } from '../errors.js'

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

export class AgentRunner {
  constructor(private deps: AgentRunnerDeps) {}

  async handle(
    msg: IncomingMsg,
    onStep?: (s: RunnerStep) => void,
  ): Promise<{ conversationId: string; text: string }> {
    const cfg = getAgentConfig()
    const conv = await this.deps.conversation.getOrCreate(msg)
    onStep?.({ phase: 'persisted', label: '已加载会话历史', ts: Date.now() })
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)
    const tools = (await this.deps.mcpBridge.listTools())
      .filter((t: any) => isToolEnabled(t.name))
    tools.push({
      name: LOAD_SKILL_NAME,
      description: '加载 skill 完整内容',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
    } as any)
    onStep?.({ phase: 'thinking', label: '准备调用 Claude', ts: Date.now() })

    const system = buildSystemPrompt(
      { brand: msg.brand, channel: msg.channelId, conversationId: conv.conversationId },
      cfg.agentMd,
      tools,
    )

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({ role: m.role as any, content: m.content })),
      { role: 'user', content: msg.content },
    ]

    const finalText = await this.runLlmLoop(
      system, messages, msg, conv.conversationId, tools, onStep,
    )

    await this.deps.conversation.appendMessage({
      conversationId: conv.conversationId, role: 'assistant', content: finalText,
    })
    onStep?.({ phase: 'persisted', label: '已保存回复', ts: Date.now() })

    return { conversationId: conv.conversationId, text: finalText }
  }

  private async runLlmLoop(
    system: string,
    messages: Anthropic.MessageParam[],
    msg: IncomingMsg,
    conversationId: string,
    tools: Anthropic.Tool[],
    onStep?: (s: RunnerStep) => void,
  ): Promise<string> {
    const cfg = getAgentConfig()
    let iter = 0
    let finalText = ''

    while (iter < cfg.params.maxToolChainDepth) {
      iter++

      let response: Anthropic.Message
      try {
        const thinkingCfg = thinkingConfigFor(cfg.params.thinkingLevel)
        response = await this.deps.anthropic.messages.create({
          model: cfg.model,
          max_tokens: cfg.params.maxTokens,
          system,
          tools: tools as any,
          messages,
          ...(thinkingCfg ?? {}),
        })
      } catch (e) {
        onStep?.({ phase: 'thinking', label: 'Claude 调用失败', ok: false, ts: Date.now() })
        const code = mapAnthropicError(e)
        throw new LlmError(code, (e as Error).message, code !== 'LLM_AUTH', e as Error)
      }

      let turnText = ''
      const toolUses: Anthropic.ToolUseBlock[] = []
      for (const block of response.content) {
        if (block.type === 'text') turnText += block.text
        else if (block.type === 'tool_use') toolUses.push(block as any)
      }
      finalText = turnText

      await this.deps.conversation.appendMessage({
        conversationId, role: 'assistant', content: turnText,
        toolCalls: toolUses.length ? toolUses : undefined,
      })

      if (toolUses.length === 0) {
        onStep?.({ phase: 'complete', label: `Claude 已生成回复 (iter ${iter})`, ts: Date.now() })
        break
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        let content: any
        let isError = false
        let stepLabel = ''
        if (tu.name === LOAD_SKILL_NAME) {
          const skillName = (tu.input as any)?.name ?? '?'
          onStep?.({ phase: 'tool_call', label: `准备加载 skill「${skillName}」`, tool: tu.name, toolName: skillName, ts: Date.now() })
          const r = handleLoadSkill(tu.input as any)
          content = r.content
          isError = r.bytesLoaded === 0
          stepLabel = `加载 skill「${skillName}」` + (isError ? ' (失败)' : ` (${r.bytesLoaded} bytes)`)
          onStep?.({ phase: 'tool_result', label: stepLabel, tool: tu.name, toolName: skillName, ok: !isError, ts: Date.now() })
          await this.deps.notifier.push({
            type: 'task_update', conversationId,
            payload: { kind: 'skill_loaded', name: r.skillName, bytes: r.bytesLoaded },
          })
        } else {
          const tname = tu.name
          onStep?.({ phase: 'tool_call', label: `调用工具「${tname}」`, tool: tname, ts: Date.now() })
          const r = await this.deps.mcpBridge.call(tu.name, tu.input, msg.userId)
          content = r.success ? r.data : `ERROR: ${r.error}`
          isError = !r.success
          onStep?.({ phase: 'tool_result', label: `工具「${tname}」返回 ${isError ? '失败' : '成功'}`, tool: tname, ok: !isError, ts: Date.now() })
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof content === 'string' ? content : JSON.stringify(content), is_error: isError })
      }

      messages.push({ role: 'assistant', content: toolUses as any })
      messages.push({ role: 'user', content: toolResults })
    }

    return finalText
  }
}
