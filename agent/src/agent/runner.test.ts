// agent/src/agent/runner.test.ts
import { test, before } from 'node:test'
import { strict as assert } from 'node:assert'
import { AgentRunner } from './runner.ts'
import { MockMcpBridge } from '../../test/helpers/mock-mcp.ts'
import { MockAnthropic } from '../../test/helpers/mock-anthropic.ts'
import { createTestDb, cleanupTestDb } from '../../test/helpers/mock-db.ts'
import { ConversationManager } from '../conversation/manager.ts'
import { initRegistry } from '../skills/registry.ts'
import { resetAgentConfig, setCredentialConfig } from '../config/store.ts'

let pool: any
let mgr: ConversationManager
let mcp: MockMcpBridge
let llm: MockAnthropic
let runner: AgentRunner
let notifications: any[]

before(async () => {
  initRegistry()
  pool = await createTestDb()
  await cleanupTestDb(pool)
  mgr = new ConversationManager(pool, {} as any, 10)
  mcp = new MockMcpBridge()
  llm = new MockAnthropic()
  resetAgentConfig()
  setCredentialConfig(null, 'sk-test', 'claude-mock')
  notifications = []
  runner = new AgentRunner({
    anthropic: llm as any,
    mcpBridge: mcp as any,
    conversation: mgr,
    notifier: { push: async (n) => { notifications.push(n) } },
  })
})

test('单轮对话, LLM 直接返回文本', async () => {
  await cleanupTestDb(pool)
  llm.reset()
  llm.pushResponse({ text: '你好!' })

  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'hi',
  })

  assert.equal(result.text, '你好!')
})

test('LLM 调 MCP 工具后回答', async () => {
  await cleanupTestDb(pool)
  llm.reset()
  llm.pushResponse({ toolCalls: [{ name: 'get_brand_stores', input: {} }] })
  llm.pushResponse({ text: '有 3 个品牌' })
  mcp.reset()
  mcp.on('get_brand_stores', () => ({ success: true, data: { brands: ['yufeng', 'bonjur', 'tamkoko'] }, retryable: false }))

  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: '有哪些品牌',
  })

  assert.equal(result.text, '有 3 个品牌')
})

test('load_skill 走 SkillRegistry, 不调 MCP', async () => {
  await cleanupTestDb(pool)
  llm.reset()
  llm.pushResponse({ toolCalls: [{ name: 'load_skill', input: { name: 'weekly-bank-review', reason: 'test' } }] })
  llm.pushResponse({ text: 'skill 加载完成' })
  mcp.reset()

  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: '加载 skill',
  })

  assert.equal(result.text, 'skill 加载完成')
})
