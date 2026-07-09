import { test } from 'node:test'
import assert from 'node:assert'
import { registerTestChatRoute } from '../test-chat.js'
import Fastify from 'fastify'
import { getAgentConfig } from '../../../config/store.js'

// Mock the config store
const originalGetAgentConfig = getAgentConfig
const mockGetAgentConfig = () => ({
  agentMd: '# test',
  params: { thinkingLevel: 'off' as const },
  baseURL: null,
  apiKey: 'test-key',
  model: 'claude-opus-4-8',
  source: 'db' as const,
})

test('test-chat opus-4-8 + thinkingLevel=off returns 200', async () => {
  // Mock the config store
  // @ts-ignore - override for testing
  import.meta.glob = () => ({})

  // 不调真 SDK — 只断言请求体构造正确
  // 通过观察 mock Anthropic 的 messages.create / stream 入参来验证
  const receivedArgs: any[] = []
  const mockAnthropic = {
    messages: {
      create: async (args: any) => {
        receivedArgs.push(args)
        return { content: [{ type: 'text', text: 'mocked' }] }
      },
    },
  } as any

  const app = Fastify({ logger: false })
  registerTestChatRoute(app, { anthropic: mockAnthropic })

  // Inject a request - bypass config by setting up mock
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/test-chat',
    payload: { prompt: 'test', model: 'claude-opus-4-8', thinkingLevel: 'off' },
  })

  assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`)
  const last = receivedArgs[receivedArgs.length - 1]
  assert.strictEqual(last.model, 'claude-opus-4-8')
  assert.strictEqual(last.temperature, undefined, 'temperature must NOT be passed')
  assert.strictEqual(last.thinking, undefined, 'thinking must be undefined when level=off')
})
