// agent/src/mcp/bridge.test.ts
import { test, after } from 'node:test'
import { strict as assert } from 'node:assert'

// mock fetch
const originalFetch = globalThis.fetch
let mockResponses: any[] = []
;(globalThis as any).fetch = async (_url: string, _opts: any) => {
  const next = mockResponses.shift()
  return {
    json: async () => next,
    status: next?.error ? 500 : 200,
  } as any
}

after(() => { globalThis.fetch = originalFetch })

import { McpBridge } from './bridge.ts'

test('call returns data on success', async () => {
  mockResponses = [{ result: { foo: 'bar' } }]
  const bridge = new McpBridge('http://test', {} as any, 0)
  const r = await bridge.call('test_tool', { x: 1 }, 'user-1')
  assert.equal(r.success, true)
  assert.deepEqual(r.data, { foo: 'bar' })
})

test('call returns error on tool not found', async () => {
  mockResponses = [{ error: { code: -32601, message: 'method not found' } }]
  const bridge = new McpBridge('http://test', {} as any, 0)
  const r = await bridge.call('missing_tool', {}, 'user-1')
  assert.equal(r.success, false)
  assert.equal(r.retryable, false)
  assert.match(r.error!, /method not found/)
})
