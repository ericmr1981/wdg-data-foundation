// agent/src/api/admin/test-run.ts
// 全栈测试 endpoint: 跟 AgentRunner.handle() 一样支持 tool 调用, 但:
//   - 不存 DB (不写 agent.conversations / agent.messages)
//   - 可选 tools 白名单 (从 request body.tools 接)
//   - 返 {text, steps, tool_calls, usage}
//
// 用 /api/admin/test-chat (单 LLM 往返) 已有的简洁对比。
// 用这个让 admin 看到 LLM 完整 tool_use loop、tool 执行结果、token 用量。

import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, getBaseURL, thinkingConfigFor } from '../../config/store.js'
import { buildSystemPrompt } from '../../agent/prompt.js'
import { handleLoadSkill, LOAD_SKILL_NAME } from '../../skills/load-skill-tool.js'
import { isToolEnabled } from '../admin/tools.js'
import { McpBridge } from '../../mcp/bridge.js'
import { mapAnthropicStatusError } from '../../errors.js'

// 单次 LLM 调用超时 — 测试用, 不让坏 LLM 卡死整个 agent 进程
const LLM_CALL_TIMEOUT_MS = 60_000

interface ToolCallRecord {
  name: string
  input: Record<string, unknown>
  success: boolean
  output: unknown
  latencyMs?: number
}

interface StepRecord {
  phase: 'thinking' | 'tool_call' | 'tool_result' | 'complete' | 'error'
  label: string
  toolName?: string
  ok?: boolean
  ts: number
}

interface TestRunBody {
  prompt: string
  system?: string
  maxTokens?: number
  // 可选: 只跑白名单里的 tool。空/未设 = 全跑
  toolsWhitelist?: string[]
  // 多深 (默认读 cfg.params.maxToolChainDepth, 默认 10)
  maxDepth?: number
}

export interface TestRunResponse {
  success: boolean
  text: string
  steps: StepRecord[]
  toolCalls: ToolCallRecord[]
  input_tokens: number
  output_tokens: number
  iterations: number
  model: string
  durationMs: number
  error?: string
  message?: string
}

export function registerTestRunRoute(app: FastifyInstance, deps: {
  mcpBridge: McpBridge
}) {
  app.post<{ Body: TestRunBody }>('/api/admin/test-run', async (req, reply) => {
    const body = (req.body ?? {}) as TestRunBody
    if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim() === '') {
      return reply.code(400).send({
        success: false,
        error: 'prompt_required',
        message: 'prompt (string) is required',
      })
    }

    const cfg = getAgentConfig()
    const baseURL = getBaseURL()
    const apiKey = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return reply.code(400).send({
        success: false,
        error: 'no_api_key',
        message: 'ANTHROPIC_API_KEY not configured',
      })
    }

    const start = Date.now()
    const steps: StepRecord[] = []
    const toolCalls: ToolCallRecord[] = []
    let inputTokensTotal = 0
    let outputTokensTotal = 0

    try {
      // 1. 拉所有 MCP 工具
      const allTools = await deps.mcpBridge.listTools()
      const enabled = allTools.filter((t: any) => isToolEnabled(t.name))
      const whitelist = body.toolsWhitelist
      const tools = whitelist && whitelist.length > 0
        ? enabled.filter((t: any) => whitelist.includes(t.name))
        : enabled
      // 加 load_skill (Agent 自己的 meta-tool)
      const toolsForClaude = [
        ...tools,
        {
          name: LOAD_SKILL_NAME,
          description: '加载 skill 完整内容',
          input_schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['name', 'reason'],
          },
        } as any,
      ]

      const client = new Anthropic({
        apiKey,
        baseURL: baseURL ?? undefined,
        // Phase 7.1: 单次 LLM 调用超时 — 防止坏 LLM / 网络卡死整个 agent
        // (用户看到 Failed (agent_unreachable) 上层会重定向到 detail="client_timeout")
        timeout: LLM_CALL_TIMEOUT_MS,
      } as any)

      // 2. 准备消息 + 系统提示
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: body.prompt },
      ]
      const system = buildSystemPrompt(
        { brand: 'admin-test', channel: 'admin-test' },
        body.system || cfg.agentMd,
        toolsForClaude,
      )

      // 3. 工具调用循环
      const maxIter = Math.min(
        body.maxDepth ?? cfg.params.maxToolChainDepth ?? 10,
        20,
      )
      steps.push({ phase: 'thinking', label: `准备调用 Claude (tools=${toolsForClaude.length})`, ts: Date.now() })

      let iter = 0
      let finalText = ''
      while (iter < maxIter) {
        iter++

        // Promise.race 防御: 万一 Anthropic SDK 的 client.timeout 不工作 (老版本),
        // 用 setTimeout 强制 60s 到期, 出错就中止这次 iter 抛给外层 catch
        const thinkingCfg = thinkingConfigFor(cfg.params.thinkingLevel)
        const llmPromise = client.messages.create({
          model: cfg.model,
          max_tokens: body.maxTokens ?? cfg.params.maxTokens ?? 4096,
          system,
          tools: toolsForClaude as any,
          messages,
          ...(thinkingCfg ?? {}),
        })
        let llmTimer: NodeJS.Timeout | undefined
        const llmTimeoutPromise = new Promise<never>((_, reject) => {
          llmTimer = setTimeout(
            () => reject(new Error(`LLM call timeout after ${LLM_CALL_TIMEOUT_MS}ms (iter ${iter})`)),
            LLM_CALL_TIMEOUT_MS,
          )
        })
        const resp = await Promise.race([llmPromise, llmTimeoutPromise]).finally(
          () => { if (llmTimer) clearTimeout(llmTimer) },
        ) as Anthropic.Message
        inputTokensTotal += resp.usage.input_tokens
        outputTokensTotal += resp.usage.output_tokens

        let turnText = ''
        const toolUses: Anthropic.ToolUseBlock[] = []
        for (const block of resp.content) {
          if (block.type === 'text') turnText += block.text
          else if (block.type === 'tool_use') toolUses.push(block as any)
        }
        finalText = turnText

        if (toolUses.length === 0) {
          steps.push({
            phase: 'complete',
            label: `Claude 已生成回复 (iter ${iter})`,
            ts: Date.now(),
          })
          break
        }

        // 执行工具
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          const tcallStart = Date.now()
          let content: any
          let isError = false
          let label = ''
          if (tu.name === LOAD_SKILL_NAME) {
            const skillName = (tu.input as any)?.name ?? '?'
            steps.push({
              phase: 'tool_call',
              label: `加载 skill「${skillName}」`,
              toolName: skillName,
              ts: tcallStart,
            })
            const r = handleLoadSkill(tu.input as any)
            content = r.content
            isError = r.bytesLoaded === 0
            label = `加载 skill「${skillName}」${isError ? ' (失败)' : ` (${r.bytesLoaded} bytes)`}`
            toolCalls.push({
              name: tu.name,
              input: tu.input as Record<string, unknown>,
              success: !isError,
              output: content,
              latencyMs: Date.now() - tcallStart,
            })
            steps.push({
              phase: 'tool_result',
              label,
              toolName: skillName,
              ok: !isError,
              ts: Date.now(),
            })
          } else {
            steps.push({
              phase: 'tool_call',
              label: `调用工具「${tu.name}」`,
              toolName: tu.name,
              ts: tcallStart,
            })
            const r = await deps.mcpBridge.call(
              tu.name,
              tu.input,
              'admin-test-user',
            )
            content = r.success ? r.data : `ERROR: ${r.error}`
            isError = !r.success
            label = `工具「${tu.name}」${isError ? '失败' : '成功'}`
            toolCalls.push({
              name: tu.name,
              input: tu.input as Record<string, unknown>,
              success: !isError,
              output: content,
              latencyMs: Date.now() - tcallStart,
            })
            steps.push({
              phase: 'tool_result',
              label,
              toolName: tu.name,
              ok: !isError,
              ts: Date.now(),
            })
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            is_error: isError,
          })
        }

        messages.push({ role: 'assistant', content: toolUses as any })
        messages.push({ role: 'user', content: toolResults as any })
      }

      const resp: TestRunResponse = {
        success: true,
        text: finalText,
        steps,
        toolCalls,
        input_tokens: inputTokensTotal,
        output_tokens: outputTokensTotal,
        iterations: iter,
        model: cfg.model,
        durationMs: Date.now() - start,
      }
      return resp
    } catch (e: any) {
      steps.push({
        phase: 'error',
        label: e?.message ?? 'unknown error',
        ok: false,
        ts: Date.now(),
      })
      const code = (e && typeof e === 'object' && 'status' in e) ? (e as any).status : undefined
      return reply.code(200).send({
        success: false,
        text: '',
        steps,
        toolCalls,
        input_tokens: inputTokensTotal,
        output_tokens: outputTokensTotal,
        iterations: 0,
        model: cfg.model,
        durationMs: Date.now() - start,
        error: mapAnthropicStatusError(e) ?? 'llm_call_failed',
        message: e?.message ?? String(e),
        details: code ? { statusCode: code } : undefined,
      } as TestRunResponse)
    }
  })
}
