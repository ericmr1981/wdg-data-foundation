// agent/src/api/admin/test-connection.ts
import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { getAgentConfig } from '../../config/store.js'

export function registerTestConnectionRoute(app: FastifyInstance) {
  // 不需要 admin 鉴权 — 任何用户都能测, 看 API key 是否配
  // (admin 才能改, 但测连接是只读, 任何人都能)

  app.post('/api/admin/test-connection', async (req, reply) => {
    const cfg = getAgentConfig()

    // 1. 检查 API key 是否配
    if (!cfg.apiKey && !process.env.ANTHROPIC_API_KEY) {
      return reply.code(400).send({
        success: false,
        error: 'no_api_key',
        message: 'ANTHROPIC_API_KEY not configured. Set it in .env or admin/config.',
      })
    }

    // 2. 试发一个最小消息
    try {
      const client = new Anthropic({
        apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY!,
        baseURL: cfg.baseURL ?? undefined,
      })

      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping' }],
      })

      return {
        success: true,
        message: 'Connection OK',
        details: {
          model: cfg.model,
          baseURL: cfg.baseURL ?? '(default)',
          input_tokens: res.usage.input_tokens,
          output_tokens: res.usage.output_tokens,
          stop_reason: res.stop_reason,
        },
      }
    } catch (e: any) {
      const code = e?.status ?? e?.statusCode
      return reply.code(200).send({
        success: false,
        error: 'llm_call_failed',
        message: e.message,
        details: {
          model: cfg.model,
          statusCode: code,
        },
      })
    }
  })
}
