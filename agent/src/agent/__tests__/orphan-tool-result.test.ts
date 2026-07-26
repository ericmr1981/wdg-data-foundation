import { test } from 'node:test'
import assert from 'node:assert'
import { pruneOrphanToolResults } from '../runner.js'

test('keeps tool_result whose tool_use precedes it', () => {
  const msgs = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'q', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  ] as any
  const out = pruneOrphanToolResults(msgs)
  assert.strictEqual(((out[1]!.content) as any[]).length, 1)
  assert.strictEqual(((out[1]!.content) as any[])[0].type, 'tool_result')
})

test('drops orphan tool_result without preceding tool_use', () => {
  const msgs = [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'orphan', content: 'x' }] },
  ] as any
  const out = pruneOrphanToolResults(msgs)
  // 内容被修剪为空 → 用占位 text 替代,避免空 user 消息
  assert.strictEqual(out.length, 1)
  assert.strictEqual(((out[0]!.content) as any[])[0].type, 'text')
})

test('drops only the orphan tool_result when a valid one coexists', () => {
  const msgs = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'q', input: {} }] },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
        { type: 'tool_result', tool_use_id: 'orphan', content: 'bad' },
      ],
    },
  ] as any
  const out = pruneOrphanToolResults(msgs)
  const results = ((out[1]!.content) as any[]).filter((b: any) => b.type === 'tool_result')
  assert.strictEqual(results.length, 1)
  assert.strictEqual(results[0].tool_use_id, 't1')
})
