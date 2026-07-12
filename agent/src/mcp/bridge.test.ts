// agent/src/mcp/bridge.test.ts
import { test, after, beforeEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { UnifiedMcpBridge } from './bridge.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  ;(globalThis as any).fetch = async (_url: string, opts: any) => {
    const body = JSON.parse(opts.body as string)
    const method = body.method as string
    const id = body.id as number | undefined

    // Notification — no response expected. Client.send() resolves without calling onmessage.
    if (id === undefined) {
      return {
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any
    }

    if (method === 'initialize') {
      return {
        status: 200,
        json: async () => ({
          jsonrpc: '2.0', id,
          result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test', version: '1.0' } },
        }),
        text: async () => '',
      } as any
    }

    if (method === 'tools/list') {
      return {
        status: 200,
        json: async () => ({
          jsonrpc: '2.0', id,
          result: { tools: [{ name: 'test_tool', description: 'a test tool', inputSchema: { type: 'object', properties: {} } }] },
        }),
        text: async () => '',
      } as any
    }

    if (method === 'tools/call') {
      return {
        status: 200,
        json: async () => ({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'hello' }] },
        }),
        text: async () => '',
      } as any
    }

    return {
      status: 404,
      json: async () => ({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Not found' } }),
      text: async () => 'not found',
    } as any
  }
})

after(() => {
  globalThis.fetch = originalFetch
})

test('connectBackends + call returns data on success', async () => {
  const bridge = new UnifiedMcpBridge()
  await bridge.connectBackends([{
    name: 'test', url: 'http://test/api/mcp', transport: 'fetch',
  }])
  assert.equal(bridge.backendCount, 1)
  assert.equal(bridge.toolCount, 1)

  const r = await bridge.call('test_tool', { x: 1 })
  assert.equal(r.success, true)
  assert.equal(r.data, 'hello')
  await bridge.disconnectAll()
})

test('call returns error on unknown tool', async () => {
  const bridge = new UnifiedMcpBridge()
  const r = await bridge.call('missing_tool', {})
  assert.equal(r.success, false)
  assert.equal(r.retryable, false)
  assert.match(r.error!, /Unknown tool/)
})

test('connectBackends is idempotent', async () => {
  const bridge = new UnifiedMcpBridge()
  await bridge.connectBackends([{
    name: 'test', url: 'http://test/api/mcp', transport: 'fetch',
  }])
  const count1 = bridge.backendCount
  await bridge.connectBackends([{
    name: 'test', url: 'http://test/api/mcp', transport: 'fetch',
  }])
  assert.equal(bridge.backendCount, count1)
  await bridge.disconnectAll()
})

test('disconnectAll clears state', async () => {
  const bridge = new UnifiedMcpBridge()
  await bridge.connectBackends([{
    name: 'test', url: 'http://test/api/mcp', transport: 'fetch',
  }])
  assert.equal(bridge.backendCount, 1)
  await bridge.disconnectAll()
  assert.equal(bridge.backendCount, 0)
  assert.equal(bridge.toolCount, 0)
})

test('listTools throws if not connected', async () => {
  const bridge = new UnifiedMcpBridge()
  await assert.rejects(
    () => bridge.listTools(),
    /not connected/,
  )
})
