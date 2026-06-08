// agent/src/agent/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, thinkingConfigFor } from '../config/store.js'
import type { McpBridge } from '../mcp/bridge.js'
import type { ConversationManager, IncomingMsg } from '../conversation/manager.js'
import type { Notifier } from '../notifications/notifier.js'
import { initRegistry as _ } from '../skills/registry.js'  // trigger init
import { handleLoadSkill, LOAD_SKILL_NAME } from '../skills/load-skill-tool.js'
import { buildSystemPrompt } from './prompt.js'
import { LlmError, mapAnthropicError } from '../errors.js'

export interface AgentRunnerDeps {
  anthropic: Anthropic
  mcpBridge: McpBridge
  conversation: ConversationManager
  notifier: Notifier
}

export class AgentRunner {
  constructor(private deps: AgentRunnerDeps) {}

  async handle(msg: IncomingMsg): Promise<{ conversationId: string; text: string }> {
    const cfg = getAgentConfig()
    const conv = await this.deps.conversation.getOrCreate(msg)
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)
    const tools = await this.deps.mcpBridge.listTools()
    tools.push({
      name: LOAD_SKILL_NAME,
      description: '加载 skill 完整内容',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
    } as any)

    const system = buildSystemPrompt(
      { brand: msg.brand, channel: msg.channelId, conversationId: conv.conversationId },
      cfg.agentMd,
      tools,
    )

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({ role: m.role as any, content: m.content })),
      { role: 'user', content: msg.content },
    ]

    const finalText = await this.runLlmLoop(system, messages, msg, conv.conversationId, tools)

    await this.deps.conversation.appendMessage({
      conversationId: conv.conversationId, role: 'assistant', content: finalText,
    })

    return { conversationId: conv.conversationId, text: finalText }
  }

  private async runLlmLoop(
    system: string,
    messages: Anthropic.MessageParam[],
    msg: IncomingMsg,
    conversationId: string,
    tools: Anthropic.Tool[],
  ): Promise<string> {
    const cfg = getAgentConfig()
    let iter = 0
    let finalText = ''

    while (iter < cfg.params.maxToolChainDepth) {
      iter++

      let response: Anthropic.Message
      try {
        response = await this.deps.anthropic.messages.create({
          model: cfg.model,
          max_tokens: cfg.params.maxTokens,
          temperature: cfg.params.temperature,
          system,
          tools: tools as any,
          messages,
          ...(thinkingConfigFor(cfg.params.thinkingLevel) ? { thinking: thinkingConfigFor(cfg.params.thinkingLevel)! } : {}),
        })
      } catch (e) {
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

      if (toolUses.length === 0) break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        let content: any
        let isError = false
        if (tu.name === LOAD_SKILL_NAME) {
          const r = handleLoadSkill(tu.input as any)
          content = r.content
          isError = r.bytesLoaded === 0
          await this.deps.notifier.push({
            type: 'task_update', conversationId,
            payload: { kind: 'skill_loaded', name: r.skillName, bytes: r.bytesLoaded },
          })
        } else {
          const r = await this.deps.mcpBridge.call(tu.name, tu.input, msg.userId)
          content = r.success ? r.data : `ERROR: ${r.error}`
          isError = !r.success
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof content === 'string' ? content : JSON.stringify(content), is_error: isError })
      }

      messages.push({ role: 'assistant', content: toolUses as any })
      messages.push({ role: 'user', content: toolResults })
    }

    return finalText
  }
}
