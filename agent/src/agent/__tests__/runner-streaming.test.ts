// agent/src/agent/__tests__/runner-streaming.test.ts
// R4 (Phase 1b): verify runner drives anthropic.beta.messages.toolRunner({stream:true})
// and never passes temperature. env RUNNER_USE_TOOL_RUNNER=0 falls back to messages.create.
import { test } from 'node:test'
import assert from 'node:assert'
import { AgentRunner } from '../runner.ts'

// Fake Anthropic that records both toolRunner cfg and messages.create args.
function makeMockAnthropic(responses: any[]): any {
  const mockAnthropic: any = {
    __toolRunnerCfg: undefined,
    __lastCreateArgs: undefined,
  }
  mockAnthropic.messages = {
    create: async (args: any) => {
      mockAnthropic.__lastCreateArgs = args
      const r = responses[0] ?? { content: [{ type: 'text', text: '' }], stop_reason: 'end_turn' }
      return r
    },
  }
  mockAnthropic.beta = {
    messages: {
      toolRunner: (cfg: any) => {
        mockAnthropic.__toolRunnerCfg = cfg
        // fake SDK toolRunner: async iterable yielding whatever responses were given
        return (async function* () {
          for (const r of responses) yield r
        })()
      },
    },
  }
  return mockAnthropic
}

function makeDeps(responses: any[] = []) {
  return {
    anthropic: makeMockAnthropic(responses),
    mcpBridge: { listTools: async () => [], call: async () => ({ success: true, data: '' }) } as any,
    conversation: {
      getOrCreate: async () => ({ conversationId: 'conv-1' }),
      getMessages: async () => [],
      appendMessage: async () => {},
      recordEvent: async () => {},
    } as any,
    notifier: { push: async () => {} } as any,
  }
}

test('runner uses toolRunner({stream:true}) when RUNNER_USE_TOOL_RUNNER!=0', async () => {
  process.env.RUNNER_USE_TOOL_RUNNER = '1'
  const deps = makeDeps()
  const runner = new AgentRunner(deps as any)
  const emitter = { send: async () => {} }
  await runner.handle(
    { channelId: 'web', userId: 'u1', brand: null, conversationId: 'conv-1', content: 'hi' } as any,
    emitter as any,
  )
  const cfg = (deps.anthropic as any).__toolRunnerCfg
  assert.ok(cfg, 'must call toolRunner')
  assert.strictEqual(cfg.stream, true, 'must stream:true')
  assert.strictEqual(cfg.temperature, undefined, 'must NOT pass temperature')
  assert.strictEqual(cfg.thinking, undefined, 'thinkingLevel=off → no thinking')
  delete process.env.RUNNER_USE_TOOL_RUNNER
})

test('runner does NOT pass temperature to toolRunner', async () => {
  process.env.RUNNER_USE_TOOL_RUNNER = '1'
  const deps = makeDeps()
  const runner = new AgentRunner(deps as any)
  await runner.handle(
    { channelId: 'web', userId: 'u', brand: null, conversationId: 'c', content: 'q' } as any,
    { send: async () => {} } as any,
  )
  const cfg = (deps.anthropic as any).__toolRunnerCfg
  assert.strictEqual(cfg.temperature, undefined)
  delete process.env.RUNNER_USE_TOOL_RUNNER
})

test('RUNNER_USE_TOOL_RUNNER=0 falls back to messages.create (no toolRunner, no temperature)', async () => {
  process.env.RUNNER_USE_TOOL_RUNNER = '0'
  const deps = makeDeps([{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }])
  const runner = new AgentRunner(deps as any)
  await runner.handle(
    { channelId: 'web', userId: 'u', brand: null, conversationId: 'c', content: 'q' } as any,
    { send: async () => {} } as any,
  )
  assert.strictEqual((deps.anthropic as any).__toolRunnerCfg, undefined, 'env=0 must NOT call toolRunner')
  const args = (deps.anthropic as any).__lastCreateArgs
  assert.ok(args, 'env=0 must call messages.create')
  assert.strictEqual(args.temperature, undefined, 'legacy path also omits temperature')
  delete process.env.RUNNER_USE_TOOL_RUNNER
})
