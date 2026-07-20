// agent/src/api/admin/test-run.ts
// 全栈测试 endpoint: 调真实 AgentRunner.handle()。
//
// 设计:
//   - 不自己 new Anthropic client,不写自己的 tool 循环
//   - 构造 IncomingMsg { channelId: 'admin-test', userId, content: prompt }
//   - 构造 in-memory emitter,runner.handle() 里 recordAndSend 推的每条 frame 都收下来
//   - runner.handle() 返回 { conversationId } 拿到会话 id
//   - 遍历 frames 重组成 {text, steps, toolCalls, iterations, usage, model, durationMs, conversationId}
//   跟原 TestRunResponse 形状一致,UI 不用改。
//
// runner 内部会:
//   - DB: agent.conversations / agent.messages / agent.message_events
//   - LLM: anthropic.beta.messages.toolRunner(...) (生产路径)
//   - tools: mcpBridge.call(...)

import type { FastifyInstance } from 'fastify'
import { getAgentConfig } from '../../config/store.js'
import type { AgentRunner } from '../../agent/runner.js'
import type { UnifiedMcpBridge } from '../../mcp/bridge.js'
import type { IncomingMsg } from '../../conversation/manager.js'

interface TestRunBody {
  prompt: string
  system?: string
  maxTokens?: number
  toolsWhitelist?: string[]
  maxDepth?: number
}

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

interface TestRunResponse {
  success: boolean
  text: string
  steps: StepRecord[]
  toolCalls: ToolCallRecord[]
  input_tokens: number
  output_tokens: number
  iterations: number
  model: string
  durationMs: number
  conversationId?: string
  error?: string
  message?: string
}

interface RunnerFrame {
  type: string
  payload?: any
}

export function registerTestRunRoute(
  app: FastifyInstance,
  deps: { mcpBridge: UnifiedMcpBridge; runner: AgentRunner },
) {
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
    const start = Date.now()
    const frames: RunnerFrame[] = []

    // admin role 已由 /api/admin/* 的 preHandler hook 校验过
    // (agent/src/api/admin/config.ts:22-26)
    const userId = String(req.headers['x-wdg-user-id'] ?? 'admin-test')

    const msg: IncomingMsg = {
      channelId: 'admin-test',
      userId,
      brand: null,
      conversationId: null, // runner 会自己 getOrCreate
      content: body.prompt,
    }

    const emitter = {
      send: async (frame: RunnerFrame) => {
        frames.push(frame)
      },
    }

    let result: { conversationId: string; messageId?: string }
    try {
      result = await deps.runner.handle(msg, emitter)
    } catch (e: any) {
      return reply.code(200).send({
        success: false,
        text: '',
        steps: [
          {
            phase: 'error',
            label: e?.message ?? 'runner threw',
            ok: false,
            ts: Date.now(),
          },
        ],
        toolCalls: [],
        input_tokens: 0,
        output_tokens: 0,
        iterations: 0,
        model: cfg.model,
        durationMs: Date.now() - start,
        error: 'runner_threw',
        message: e?.message ?? String(e),
      } satisfies TestRunResponse)
    }

    const reshaped = reshapeFramesToResponse(frames, cfg.model, start, result.conversationId)

    // 如果 runner 没推任何 frame,标记 no_events
    if (frames.length === 0) {
      return reply.code(200).send({
        ...reshaped,
        success: false,
        error: 'no_events',
        message: 'runner.handle() 完成但未推送任何事件,可能 toolRunner 静默挂起被外层 catch 兜住',
      } satisfies TestRunResponse)
    }

    return reshaped
  })
}

/**
 * 把 runner handle() 推出来的 frames 重组成 TestRunResponse。
 * 遍历一次,按 frame.type 分流,见 plan §"Frame → response mapping"。
 */
function reshapeFramesToResponse(
  frames: RunnerFrame[],
  model: string,
  start: number,
  conversationId: string,
): TestRunResponse {
  const steps: StepRecord[] = []
  const toolCalls: ToolCallRecord[] = []
  const pendingToolUses = new Map<string, { name: string; input: any; ts: number }>()
  let text = ''
  let iterations = 0
  let inputTokens = 0
  let outputTokens = 0
  let sawError = false
  let errorMessage = ''

  for (const f of frames) {
    switch (f.type) {
      case 'text_block': {
        const t = f.payload?.text ?? ''
        if (t) {
          text += t
          steps.push({
            phase: 'thinking',
            label: t.length > 60 ? t.slice(0, 60) + '…' : t,
            ts: Date.now(),
          })
        }
        break
      }
      case 'message_start': {
        iterations++
        steps.push({
          phase: 'thinking',
          label: `turn ${iterations} start`,
          ts: Date.now(),
        })
        // input_tokens 通常挂在 message_start.payload.message.usage.input_tokens
        const usage = f.payload?.message?.usage
        if (usage?.input_tokens) inputTokens += usage.input_tokens
        break
      }
      case 'message_delta': {
        // output_tokens 累加(每个 turn 一次)
        const usage = f.payload?.usage
        if (usage?.output_tokens) outputTokens += usage.output_tokens
        break
      }
      case 'tool_use': {
        const tu = f.payload
        const toolUseId = tu?.id ?? `pending-${pendingToolUses.size}`
        pendingToolUses.set(toolUseId, {
          name: tu?.name ?? '?',
          input: tu?.input ?? {},
          ts: Date.now(),
        })
        steps.push({
          phase: 'tool_call',
          label: `调用工具「${tu?.name ?? '?'}」`,
          toolName: tu?.name,
          ts: Date.now(),
        })
        break
      }
      case 'tool_result': {
        const tr = f.payload
        const toolUseId = tr?.tool_use_id
        const pending = toolUseId ? pendingToolUses.get(toolUseId) : undefined
        const name = pending?.name ?? tr?.name ?? '?'
        const isError = !!tr?.is_error
        const content = tr?.content
        const output =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((c: any) => (typeof c === 'string' ? c : JSON.stringify(c))).join('\n')
              : content
        toolCalls.push({
          name,
          input: pending?.input ?? {},
          success: !isError,
          output,
          latencyMs: pending ? Date.now() - pending.ts : undefined,
        })
        steps.push({
          phase: 'tool_result',
          label: `工具「${name}」${isError ? '失败' : '成功'}`,
          toolName: name,
          ok: !isError,
          ts: Date.now(),
        })
        pendingToolUses.delete(toolUseId ?? '')
        break
      }
      case 'message': {
        // finalMessage (整条 message 对象) — 有些路径 text_block 不发,只走这里
        const blocks = f.payload?.content ?? []
        for (const b of blocks) {
          if (b?.type === 'text' && b.text && !text.includes(b.text)) {
            text += b.text
          }
        }
        const usage = f.payload?.usage
        if (usage?.input_tokens) inputTokens = usage.input_tokens
        if (usage?.output_tokens) outputTokens = usage.output_tokens
        break
      }
      case 'interrupted': {
        sawError = true
        errorMessage = '用户中断'
        steps.push({
          phase: 'error',
          label: 'user interrupt',
          ok: false,
          ts: Date.now(),
        })
        break
      }
      case 'error': {
        sawError = true
        errorMessage = f.payload?.message ?? 'runner error'
        steps.push({
          phase: 'error',
          label: errorMessage,
          ok: false,
          ts: Date.now(),
        })
        break
      }
      case 'content_block_delta':
      case 'content_block_start':
      case 'content_block_stop':
      case 'message_stop':
        // 噪音:chunk 级 / turn-end marker,不在 UI 展示
        break
      default:
        // 未知 frame — 留个痕迹便于排查
        steps.push({
          phase: 'thinking',
          label: `[unknown frame: ${f.type}]`,
          ts: Date.now(),
        })
        break
    }
  }

  // 若全程无错误但也无文本产出,标一个 complete step 给 UI 看
  if (!sawError && steps.length > 0) {
    steps.push({
      phase: 'complete',
      label: `完成 (${iterations} turn${iterations === 1 ? '' : 's'})`,
      ts: Date.now(),
    })
  }

  return {
    success: !sawError && text.length > 0,
    text,
    steps,
    toolCalls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    iterations,
    model,
    durationMs: Date.now() - start,
    conversationId,
    error: sawError ? 'runner_error' : undefined,
    message: sawError ? errorMessage : undefined,
  }
}
