// agent/src/conversation/manager.test.ts
// 短期记忆 ConversationManager 单测 — getOrCreate / appendMessage / 顺序读回

import { test, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import { ConversationManager } from './manager.ts'
import { createTestDb, cleanupTestDb } from '../../test/helpers/mock-db.ts'

let pool: any
let mgr: ConversationManager

before(async () => {
  pool = await createTestDb()
  mgr = new ConversationManager(pool, {} as any, 10)
})

after(async () => {
  await pool.end()
})

test('getOrCreate creates new conversation', async () => {
  await cleanupTestDb(pool)
  const { conversationId } = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: 'yufeng', conversationId: null, content: 'hi',
  })
  assert.match(conversationId, /^[0-9a-f-]+$/)
})

test('appendMessage + getMessages returns in order', async () => {
  await cleanupTestDb(pool)
  const { conversationId } = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'first',
  })
  await mgr.appendMessage({ conversationId, role: 'user', content: 'first' })
  await mgr.appendMessage({ conversationId, role: 'assistant', content: 'reply' })
  const msgs = await mgr.getMessages(conversationId, 10)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0]!.content, 'first')
  assert.equal(msgs[1]!.content, 'reply')
})

test('getOrCreate with existing id returns same', async () => {
  await cleanupTestDb(pool)
  const first = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: null, conversationId: null, content: 'x',
  })
  const second = await mgr.getOrCreate({
    channelId: 'web', userId: 'u1', brand: null, conversationId: first.conversationId, content: 'y',
  })
  assert.equal(first.conversationId, second.conversationId)
})
