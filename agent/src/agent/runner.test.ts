// agent/src/agent/runner.test.ts
// R4: runner 内部机制换成 toolRunner({stream:true})。
// 本文件覆盖 env 旁路(RUNNER_USE_TOOL_RUNNER=0)的非流式回退路径 —
// 这是回退旁路,必须保持可用。toolRunner 流式路径的行为断言见 __tests__/runner-streaming.test.ts。
import { test, before, beforeEach } from 'node:test'
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

// 收集 runner 通过 emitter 回推的帧,便于断言
function makeCapture() {
  const frames: any[] = []
  return { emitter: { send: async (f: any) => { frames.push(f) } }, frames }
}

// 从 emitter 帧里取回推的 message(env 旁路走 messages.create,单帧)
function lastMessage(frames: any[]): any {
  const f = frames[frames.length - 1]
  return f?.payload?.message
}

function textOf(message: any): string {
  return (message?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
}

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

// 全部用回退旁路,确保测的是非流式 messages.create 分支
beforeEach(() => { process.env.RUNNER_USE_TOOL_RUNNER = '0' })

test('env 旁路: 单轮对话, LLM 直接返回文本(messages.create)', async () => {
  await cleanupTestDb(pool)
  llm.reset()
  llm.pushResponse({ text: '你好!' })

  const { emitter, frames } = makeCapture()
  const result = await runner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'hi',
  }, emitter as any)

  assert.ok(result.conversationId)
  assert.equal(textOf(lastMessage(frames)), '你好!')
})

test('env 旁路: 会话上下文 + 用户内容进 messages, system 走 buildSystemBlocks', async () => {
  await cleanupTestDb(pool)
  llm.reset()
  llm.pushResponse({ text: 'ok' })

  const { emitter } = makeCapture()
  await runner.handle({
    channelId: 'web', userId: 'u1', brand: 'gelatomiiix', conversationId: null, content: '有哪些品牌',
  }, emitter as any)

  const args = (llm as any).responses  // sanity: 消费了一条响应
  assert.equal((llm as any).callIndex, 1)
  assert.ok(Array.isArray(args))
})

test('env 旁路: 不向 SDK 传 temperature', async () => {
  await cleanupTestDb(pool)
  llm.reset()
  llm.pushResponse({ text: 'x' })

  // 包一层记录 messages.create 入参
  let seenArgs: any
  const spy = {
    messages: { create: async (a: any) => { seenArgs = a; return { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } } },
    beta: { messages: { toolRunner: () => { throw new Error('should not call toolRunner in env=0') } } },
  }
  const spyRunner = new AgentRunner({
    anthropic: spy as any, mcpBridge: mcp as any, conversation: mgr, notifier: { push: async () => {} },
  })
  const { emitter } = makeCapture()
  await spyRunner.handle({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'q',
  }, emitter as any)

  assert.strictEqual(seenArgs.temperature, undefined)
  assert.ok(seenArgs.system, 'system blocks present')
})
