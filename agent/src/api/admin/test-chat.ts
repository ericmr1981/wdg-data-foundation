// agent/src/api/admin/test-chat.ts
// 测试 endpoint: 用 Agent 当前配置发一条简单 chat, 返文本 + token 用量。
// 不存 DB, 不走 MCP 工具调用 — 纯 LLM 一次往返。
// 用途: /u/admin/agent-config/test 调试页面, 给 admin 验证现在改的 key + model + baseURL 都通。

import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig, getBaseURL } from '../../config/store.js'

interface TestChatBody {
  prompt: string
  system?: string
  maxTokens?: number
}

export function registerTestChatRoute(app: FastifyInstance) {
  app.post<{ Body: TestChatBody }>('/api/admin/test-chat', async (req, reply) => {
    const { prompt, system, maxTokens } = (req.body ?? {}) as TestChatBody
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return reply.code(400).send({
        success: false,
        error: 'prompt_required',
        message: 'prompt (string) is required',
      })
    }
    const cfg = getAgentConfig()
    if (!cfg.apiKey) {
      return reply.code(400).send({
        success: false,
        error: 'no_api_key',
        message: 'agent.config DB row has no api_key (admin must configure it)',
      })
    }

    try {
      const client = new Anthropic({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL ?? undefined,
      })
      const start = Date.now()
      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: maxTokens ?? 256,
        system: system || 'You are a test responder. Reply briefly and helpfully.',
        messages: [{ role: 'user', content: prompt }],
      })
      const text = res.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
      return {
        success: true,
        model: cfg.model,
        baseURL: baseURL ?? '(default)',
        text,
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        stop_reason: res.stop_reason,
        durationMs: Date.now() - start,
      }
    } catch (e: any) {
      const code = e?.status ?? e?.statusCode
      return reply.code(200).send({
        success: false,
        error: 'llm_call_failed',
        message: e.message ?? String(e),
        details: { model: cfg.model, statusCode: code },
      })
    }
  })
}
