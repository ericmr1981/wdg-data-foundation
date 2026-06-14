# WDG v1 — AgentRunner (LLM 循环)

> v0: 一个 13KB 的 /api/chat/route.ts 文件, 干所有事
> v1: 拆成 AgentRunner, 只管 "LLM 循环 + 工具调用", 其他都下放给子模块

## 1. 职责

```
AgentRunner 负责:
  · 接收 IncomingMsg
  · 拼 system prompt (用 ConfigStore + SkillRegistry + McpBridge.listTools)
  · 调 Anthropic SDK (流式)
  · 工具调用循环 (load_skill 走 SkillRegistry, 其他走 McpBridge)
  · 持久化到 conversation (短期记忆)
  · 写 audit log
  · 流式推给 Channel (text_delta / text_block / tool_call / done)

AgentRunner 不负责:
  · 鉴权 (由 Channel 适配层做)
  · 配置管理 (ConfigStore)
  · Skill 加载 (SkillRegistry)
  · MCP 调用 (McpBridge)
  · 任务调度 (TaskScheduler, 长任务走它)
```

## 2. 核心类型

```typescript
// agent/src/agent/runner.ts

import Anthropic from '@anthropic-ai/sdk'
import { McpBridge } from '../mcp/bridge'
import { ConfigStore, AgentConfig } from '../config/store'
import { SkillRegistry, listSkillDescriptions, handleLoadSkill } from '../skills/registry'
import { ConversationManager } from '../conversation/manager'
import { Notifier } from '../notifications/notifier'
import { IncomingMsg, OutgoingMsg } from '../channels/types'

export interface AgentRunnerDeps {
  configStore: ConfigStore
  skillRegistry: SkillRegistry
  mcpBridge: McpBridge
  conversation: ConversationManager
  notifier: Notifier
  anthropic: Anthropic
}

export class AgentRunner {
  constructor(private deps: AgentRunnerDeps) {}

  /**
   * 处理一条 IncomingMsg, 返回最终响应。
   * 不直接 send 给 Channel — 由 ChannelManager 负责 send。
   */
  async handle(msg: IncomingMsg): Promise<{
    conversationId: string
    text: string
  }> {
    // 1. 准备对话
    const conv = await this.deps.conversation.getOrCreate(msg)
    const history = await this.deps.conversation.getMessages(conv.conversationId, 10)
    const tools = await this.deps.mcpBridge.listTools()
    const system = this.buildSystemPrompt(msg, tools)

    // 2. LLM 循环
    const finalText = await this.runLlmLoop(
      system,
      history,
      msg,
      conv.conversationId,
    )

    // 3. 持久化最终回答
    await this.deps.conversation.appendMessage({
      conversationId: conv.conversationId,
      role: 'assistant',
      content: finalText,
    })

    return { conversationId: conv.conversationId, text: finalText }
  }

  // ─── System Prompt 拼装 ───────────────────

  private buildSystemPrompt(msg: IncomingMsg, tools: Anthropic.Tool[]): string {
    const cfg = this.deps.configStore.get()
    const skillIndex = this.deps.skillRegistry.listDescriptions()
    const today = new Date().toISOString().slice(0, 10)
    const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n')

    return `${cfg.agentMd}            // ← 业务指令 (admin 可改)

# Today
${today}

# Current Context
channel=${msg.channelId}, brand=${msg.brand ?? '<none>'}

# Available Skills
${skillIndex}                       // ← ~500 tokens, 常驻

# Tools (${tools.length})
${toolList}
${loadSkillToolDescription}          // ← load_skill 工具的描述

# General Rules
- Use tools. Don't make up numbers.
- 中文回答
- 单次工具链 ≤ ${cfg.params.maxToolChainDepth}

# Bank Classification
${cfg.bankRule}                      // ← 从 skill 加载的硬规则

# Financial
${cfg.financialRateRule}

# Forbidden
${cfg.forbidden}`
  }
}
```

## 3. LLM 循环 (核心)

```typescript
// agent/src/agent/runner.ts (继续)

private async runLlmLoop(
  system: string,
  history: ConversationMessage[],
  msg: IncomingMsg,
  conversationId: string,
): Promise<string> {
  const cfg = this.deps.configStore.get()
  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: msg.content },
  ]

  let finalText = ''
  let iter = 0
  let totalTokens = 0

  while (iter < cfg.params.maxToolChainDepth) {
    iter++

    // 调 LLM
    const stream = this.deps.anthropic.messages.stream({
      model: cfg.model,
      max_tokens: cfg.params.maxTokens,
      temperature: cfg.params.temperature,
      system,
      tools: await this.deps.mcpBridge.listTools(),
      messages,
      thinking: thinkingConfigFor(cfg.params.thinkingLevel),
    })

    // 流式推给 UI
    let turnText = ''
    let turnThinking = ''
    const toolUses: Anthropic.ToolUseBlock[] = []

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          toolUses.push(event.content_block)
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          turnText += event.delta.text
          await this.deps.notifier.push(conversationId, {
            type: 'text_delta',
            payload: { text: event.delta.text },
          })
        } else if (event.delta.type === 'thinking_delta') {
          turnThinking += event.delta.thinking
          await this.deps.notifier.push(conversationId, {
            type: 'thinking_delta',
            payload: { text: event.delta.thinking },
          })
        }
      } else if (event.type === 'message_delta') {
        totalTokens = event.usage.output_tokens
      }
    }

    finalText = turnText

    // 持久化 assistant 消息
    await this.deps.conversation.appendMessage({
      conversationId,
      role: 'assistant',
      content: turnText,
      tool_calls: toolUses.length ? toolUses : null,
      thinking: turnThinking || null,
    })

    // 没有 tool_use → LLM 答完了, 退出
    if (toolUses.length === 0) break

    // 有 tool_use → 全部执行
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      // 推 UI: 工具调用开始
      await this.deps.notifier.push(conversationId, {
        type: 'tool_call',
        payload: { name: tu.name, input: tu.input },
      })

      // 执行
      const result = await this.executeTool(tu, msg, conversationId)

      // 推 UI: 工具结果
      await this.deps.notifier.push(conversationId, {
        type: 'tool_result',
        payload: { name: tu.name, success: !result.is_error, preview: previewResult(result) },
      })

      // 写 audit
      await this.deps.conversation.appendMessage({
        conversationId,
        role: 'tool',
        content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        tool_results: result,
      })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: result.content,
        is_error: result.is_error,
      })
    }

    // 把工具结果塞回 messages, 让 LLM 继续
    messages.push({ role: 'assistant', content: toolUses })
    messages.push({ role: 'user', content: toolResults })

    // Token 监控
    if (totalTokens > cfg.params.tokenHardLimit) {
      finalText += '\n\n[已达到 token 上限, 对话已强制结束]'
      break
    }
  }

  return finalText
}
```

## 4. 工具执行

```typescript
// agent/src/agent/runner.ts (继续)

private async executeTool(
  toolUse: Anthropic.ToolUseBlock,
  msg: IncomingMsg,
  conversationId: string,
): Promise<{ content: any; is_error: boolean }> {
  // 1. load_skill 走 SkillRegistry (Agent 内部)
  if (toolUse.name === 'load_skill') {
    const args = toolUse.input as { name: string; reason: string }
    const text = this.deps.skillRegistry.getFullText(args.name)
    return {
      content: text ?? `ERROR: skill "${args.name}" not found`,
      is_error: !text,
    }
  }

  // 2. 其他都走 MCP Bridge
  const result = await this.deps.mcpBridge.call(
    toolUse.name,
    toolUse.input,
    msg.userId,
  )
  return {
    content: result.success ? result.data : `ERROR: ${result.error}`,
    is_error: !result.success,
  }
}

function previewResult(r: { content: any; is_error: boolean }): string {
  const s = typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
  return s.length > 200 ? s.slice(0, 200) + '...' : s
}
```

## 5. v0 → v1 改造点

| 项 | v0 (在 /api/chat/route.ts) | v1 (在 agent/src/agent/runner.ts) |
|---|---|---|
| 入口 | Next.js API Route | **ChannelManager → AgentRunner** |
| 配置读取 | `agent-config-store.ts` | **ConfigStore** (复制) |
| System prompt | `prompt.ts` 硬编码字符串 | **ConfigStore.agentMd + SkillRegistry + McpBridge** |
| 工具列表 | `mcp-bridge.listTools()` | **同上, 路径相同** |
| LLM 循环 | 直接在 route.ts 里 | **AgentRunner 自己的方法** |
| 工具调用分发 | mcp-bridge 一把抓 | **load_skill 单独走 SkillRegistry** |
| 流式输出 | SSE 推到 client | **WS 推到 ChannelManager → WebChannel** |
| Token 监控 | `token-tracker.ts` | **同上 (复制)** |
| 持久化 | session-store.ts (内存 + DB) | **ConversationManager (DB only)** |
| 鉴权 | Next.js session | **由 Channel 适配层做, AgentRunner 不感知** |

**v0 的 13KB route.ts** → 拆成 v1 的:
- `agent/runner.ts` (主要逻辑, ~250 行)
- `agent/prompt.ts` (system prompt 拼装, ~80 行)
- `mcp/bridge.ts` (MCP 桥, ~80 行)
- `skills/registry.ts` (skill 管理, ~100 行)
- `config/store.ts` (config 存储, ~150 行)
- `conversation/manager.ts` (短期记忆, ~150 行)
- `notifications/notifier.ts` (推送抽象, ~50 行)

**总和差不多,但每个文件小、独立可测**。

## 6. 这个组件你看什么

- **AgentRunner 是把所有子模块"串"起来的胶水**, 本身不持有数据
- **LLM 循环 = while + 流式 + 工具分发 + token 监控**, 跟 v0 思路一样
- **load_skill 单独走 SkillRegistry** —— 不走 MCP, 因为 skill 不是 MCP tool
- **v0 的 13KB route.ts 拆成 7 个小文件** —— 同样的总代码量, 但每个独立
- **未来扩展点**: 多模态输入 (图片/pdf)、interrupt (用户中途打断)、sub-agent (主 agent 调子 agent)
