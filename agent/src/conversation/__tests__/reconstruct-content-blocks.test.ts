import { test } from 'node:test'
import assert from 'node:assert'
import { reconstructContentBlocks } from '../content-blocks.js'

test('old string content wraps to single text block', () => {
  const blocks = reconstructContentBlocks({
    content: '本月营收...',
    tool_calls: null,
    tool_results: null,
    thinking: null,
  })
  assert.deepStrictEqual(blocks, [{ type: 'text', text: '本月营收...' }])
})

test('new jsonb content passes through', () => {
  const blocks = reconstructContentBlocks({
    content: [
      { type: 'text', text: 'hi' },
      { type: 'thinking', thinking: '思考' },
    ] as any,
    tool_calls: null,
    tool_results: null,
    thinking: null,
  })
  assert.strictEqual(blocks.length, 2)
  assert.strictEqual(blocks[1].type, 'thinking')
})

test('concatenates thinking + content + tool_calls + tool_results in order', () => {
  const blocks = reconstructContentBlocks({
    content: '正文',
    tool_calls: [{ id: 't1', name: 'query_db', input: { sql: 'SELECT 1' } }],
    tool_results: [{ tool_use_id: 't1', content: 'rows: 5', is_error: false }],
    thinking: '内心独白',
  })
  assert.deepStrictEqual(blocks, [
    { type: 'thinking', thinking: '内心独白' },
    { type: 'text', text: '正文' },
    { type: 'tool_use', id: 't1', name: 'query_db', input: { sql: 'SELECT 1' } },
    { type: 'tool_result', tool_use_id: 't1', content: 'rows: 5', is_error: false },
  ])
})

test('bad/missing data degrades to unreadable marker', () => {
  const blocks = reconstructContentBlocks({
    content: null as any,
    tool_calls: undefined as any,
    tool_results: undefined as any,
    thinking: null,
  })
  assert.deepStrictEqual(blocks, [{ type: 'text', text: '[unreadable message]' }])
})
