# WDG v1 — 测试策略

> v0: 已有 `tests/test_classify.py` (Python 单元测试) + `ui/tests/chat/*.test.ts` (前端单测)
> v1: 加 Agent Service 测试 + E2E 联调测试
> 核心挑战: LLM 调用怎么测? MCP 调用怎么 mock?

## 1. 测试金字塔

```
                          ▲
                         / \
                        /   \
                       / E2E \              ← 1-2 个, 慢, 跑通真实链路
                      /───────\
                     / 集成测试 \           ← 5-10 个, 中速, 跨模块
                    /───────────\
                   /   单元测试   \         ← 50-100 个, 快速, 隔离
                  ──────────────────
```

| 层 | 范围 | 速度 | 数量 | 工具 |
|---|---|---|---|---|
| 单元 | 单个函数 / 类 | <100ms | 50-100 | `node:test` + `tsx` |
| 集成 | 跨模块 (但 mock 外部) | <5s | 5-10 | `node:test` + Fastify.inject + 自建 mock |
| E2E | 真实链路 (含真 LLM) | <60s | 1-2 | Playwright + 真实 dev server |

## 2. 单元测试 (重点: 把 LLM / MCP / DB 都 mock 掉)

### 2.1 测试工具选择

```bash
npm install --save-dev \
  @types/node \
  tsx \
  fastify \
  # 自带 node:test 不用装
```

**用 Node.js 内置 `node:test`**, 不引 jest/vitest (减少依赖, v0 也用 node:test)。

### 2.2 测试结构

```
agent/
├── src/
│   ├── config/store.ts
│   ├── config/store.test.ts          ← 单元
│   ├── skills/registry.ts
│   ├── skills/registry.test.ts       ← 单元
│   ├── mcp/bridge.ts
│   ├── mcp/bridge.test.ts            ← 单元
│   ├── tasks/scheduler.ts
│   ├── tasks/scheduler.test.ts       ← 集成 (with test DB)
│   ├── agent/runner.ts
│   ├── agent/runner.test.ts          ← 单元 (mock everything)
│   ├── conversation/manager.ts
│   └── conversation/manager.test.ts  ← 集成 (with test DB)
└── test/
    ├── helpers/
    │   ├── mock-mcp.ts               ← mock McpBridge
    │   ├── mock-anthropic.ts         ← mock Anthropic SDK
    │   ├── mock-db.ts                ← pg-mem 或 testcontainers
    │   └── skill-fixtures.ts         ← 临时 skills 目录
    ├── integration/
    │   ├── channel-to-runner.test.ts
    │   ├── cron-to-scheduler.test.ts
    │   └── admin-config.test.ts
    └── e2e/
        ├── chat-flow.test.ts
        └── cron-weekly-review.test.ts
```

### 2.3 关键 Mock 工具

#### Mock Anthropic SDK

```typescript
// test/helpers/mock-anthropic.ts

import { EventEmitter } from 'events'
import Anthropic from '@anthropic-ai/sdk'

export interface MockResponse {
  text?: string
  toolCalls?: { name: string; input: any }[]
  thinking?: string
  error?: { code: string; message: string }
}

export class MockAnthropic extends EventEmitter {
  responses: MockResponse[] = []
  callIndex = 0

  // 替代 anthropic.messages.create
  create = async (params: any): Promise<any> => {
    const next = this.responses[this.callIndex++]
    if (!next) throw new Error('No more mock responses')
    if (next.error) {
      const err: any = new Error(next.error.message)
      err.code = next.error.code
      throw err
    }
    return {
      content: [
        ...(next.thinking ? [{ type: 'thinking', thinking: next.thinking }] : []),
        ...(next.text ? [{ type: 'text', text: next.text }] : []),
        ...(next.toolCalls?.map((tc, i) => ({
          type: 'tool_use',
          id: `tool_${i}`,
          name: tc.name,
          input: tc.input,
        })) ?? []),
      ],
      stop_reason: next.toolCalls ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    }
  }

  // 替代 anthropic.messages.stream
  stream = (params: any): any => {
    // 返回 async iterable, 模拟流式
    const next = this.responses[this.callIndex++]
    if (!next) throw new Error('No more mock responses')

    const events: any[] = []
    if (next.text) {
      events.push({ type: 'content_block_start', content_block: { type: 'text', text: '' } })
      for (const chunk of chunkString(next.text, 10)) {
        events.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } })
      }
    }
    if (next.toolCalls) {
      for (const tc of next.toolCalls) {
        events.push({ type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_1', name: tc.name, input: tc.input } })
      }
    }
    events.push({ type: 'message_stop' })

    return {
      [Symbol.asyncIterator]: async function* () {
        for (const e of events) yield e
      },
    }
  }

  pushResponse(r: MockResponse) { this.responses.push(r) }
  reset() { this.responses = []; this.callIndex = 0 }
}

function chunkString(s: string, n: number): string[] {
  const out = []
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n))
  return out
}
```

#### Mock McpBridge

```typescript
// test/helpers/mock-mcp.ts

import { McpBridge, McpCallResult } from '../../src/mcp/bridge'

export class MockMcpBridge extends McpBridge {
  // 替代真实 HTTP
  call = async (toolName: string, args: any, userId: string): Promise<McpCallResult> => {
    const handler = this.handlers[toolName]
    if (!handler) {
      return { success: false, data: null, error: `Tool not found: ${toolName}`, retryable: false }
    }
    return handler(args, userId)
  }

  listTools = async () => Object.keys(this.handlers).map(name => ({
    name,
    description: `Mock ${name}`,
    input_schema: { type: 'object', properties: {} },
  }))

  private handlers: Record<string, (args: any, userId: string) => McpCallResult> = {}

  on(toolName: string, handler: (args: any, userId: string) => McpCallResult) {
    this.handlers[toolName] = handler
  }
}
```

#### 测试用 DB (pg-mem 或 testcontainers)

```typescript
// test/helpers/mock-db.ts

import { newDb, IMemoryDb } from 'pg-mem'

let memDb: IMemoryDb

export async function createTestDb() {
  memDb = newDb()
  const pg = memDb.adapters.createPg()
  const pool = new pg.Pool()

  // 跑 schema
  const ddl = readFileSync(join(__dirname, '..', '..', '..', 'sql', '00_agent_schema.sql'), 'utf-8')
  await pool.query(ddl)

  return pool
}

export async function cleanupTestDb(pool) {
  await pool.query(`TRUNCATE agent.conversations, agent.messages, agent.tasks, agent.task_steps CASCADE`)
}
```

### 2.4 单元测试示例

#### 测试 SkillRegistry

```typescript
// agent/src/skills/registry.test.ts

import { test, beforeEach, describe } from 'node:test'
import assert from 'node:assert'
import { initRegistry, listSkillDescriptions, getSkillFullText, getSkill } from './registry'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_SKILLS_DIR = '/tmp/test-skills'

describe('SkillRegistry', () => {
  beforeEach(() => {
    rmSync(TEST_SKILLS_DIR, { recursive: true, force: true })
    mkdirSync(TEST_SKILLS_DIR)

    writeFileSync(join(TEST_SKILLS_DIR, 'skill-a.md'), `---
name: skill-a
description: A test skill for foo
---
# Skill A
body of skill a`)

    writeFileSync(join(TEST_SKILLS_DIR, 'skill-b.md'), `---
name: skill-b
description: B test skill for bar
---
# Skill B
body of skill b`)

    // 重置 registry singleton
    delete (globalThis as any).__wdg_skill_registry__
    process.env.SKILLS_DIR = TEST_SKILLS_DIR
  })

  test('initRegistry loads all skills', () => {
    initRegistry()
    const desc = listSkillDescriptions()
    assert.match(desc, /skill-a/)
    assert.match(desc, /skill-b/)
  })

  test('getSkill returns null for missing', () => {
    initRegistry()
    assert.strictEqual(getSkill('skill-x'), null)
  })

  test('getSkillFullText returns body', () => {
    initRegistry()
    const text = getSkillFullText('skill-a')
    assert.match(text!, /body of skill a/)
  })
})
```

#### 测试 AgentRunner (mock LLM + MCP)

```typescript
// agent/src/agent/runner.test.ts

import { test, beforeEach, describe } from 'node:test'
import assert from 'node:assert'
import { AgentRunner } from './runner'
import { MockAnthropic } from '../../test/helpers/mock-anthropic'
import { MockMcpBridge } from '../../test/helpers/mock-mcp'
import { ConfigStore, defaultConfig } from '../config/store'

describe('AgentRunner', () => {
  let runner: AgentRunner
  let mockLlm: MockAnthropic
  let mockMcp: MockMcpBridge
  let capturedNotifications: any[]

  beforeEach(() => {
    mockLlm = new MockAnthropic()
    mockMcp = new MockMcpBridge('', defaultConfig(), 0)

    const notifier = {
      push: async (convId: string | null, msg: any) => {
        capturedNotifications.push({ convId, ...msg })
      },
    }

    const conversation = { /* mock */ }
    const skillRegistry = { /* mock */ }

    runner = new AgentRunner({
      configStore: { get: () => defaultConfig() } as any,
      skillRegistry: skillRegistry as any,
      mcpBridge: mockMcp as any,
      conversation: conversation as any,
      notifier: notifier as any,
      anthropic: mockLlm as any,
    })

    capturedNotifications = []
  })

  test('单轮对话, LLM 直接返回文本', async () => {
    // LLM mock: 第一次调用就返回文本
    mockLlm.pushResponse({ text: '你好, 我是 Agent' })

    // MCP mock: 假设 LLM 调 get_brand_stores
    mockMcp.on('get_brand_stores', () => ({ success: true, data: { brands: [] } }))

    const result = await runner.handle({
      channelId: 'web',
      userId: 'u1',
      brand: null,
      conversationId: null,
      content: '你好',
    })

    assert.strictEqual(result.text, '你好, 我是 Agent')
  })

  test('多轮工具调用, LLM 调 MCP 后再回答', async () => {
    // LLM 第一次: 调 get_pipeline_kpi
    mockLlm.pushResponse({
      toolCalls: [{ name: 'get_pipeline_kpi', input: { brand: 'yufeng' } }],
    })
    // LLM 第二次: 拿到结果后回答
    mockLlm.pushResponse({ text: '上周未分类 89 笔' })

    mockMcp.on('get_pipeline_kpi', () => ({
      success: true,
      data: { unclassified: 89 },
    }))

    const result = await runner.handle({
      channelId: 'web',
      userId: 'u1',
      brand: 'yufeng',
      conversationId: null,
      content: '上周怎么样',
    })

    assert.strictEqual(result.text, '上周未分类 89 笔')
    assert.strictEqual(mockLlm.callIndex, 2)  // LLM 被调 2 次
  })

  test('MCP 工具返回错误, LLM 自己处理', async () => {
    mockLlm.pushResponse({
      toolCalls: [{ name: 'bad_tool', input: {} }],
    })
    mockLlm.pushResponse({ text: '该工具不可用, 请换个问题' })

    mockMcp.on('bad_tool', () => ({
      success: false,
      error: 'Tool not found',
      retryable: false,
    }))

    const result = await runner.handle({
      channelId: 'web',
      userId: 'u1',
      brand: null,
      conversationId: null,
      content: '调 bad_tool',
    })

    assert.match(result.text, /不可用/)
  })
})
```

## 3. 集成测试 (跨模块 + 真实 DB)

```typescript
// test/integration/cron-to-scheduler.test.ts

import { test, before, after } from 'node:test'
import assert from 'node:assert'
import { TaskScheduler } from '../../src/tasks/scheduler'
import { MockMcpBridge } from '../helpers/mock-mcp'
import { MockAnthropic } from '../helpers/mock-anthropic'
import { createTestDb, cleanupTestDb } from '../helpers/mock-db'
import { registerTaskHandler } from '../../src/tasks/registry'
import { initRegistry } from '../../src/skills/registry'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const TEST_SKILLS = '/tmp/test-skills-integration'

before(() => {
  mkdirSync(TEST_SKILLS, { recursive: true })
  writeFileSync(join(TEST_SKILLS, 'weekly-bank-review.md'), `---
name: weekly-bank-review
description: Test skill
---`)
  process.env.SKILLS_DIR = TEST_SKILLS
  initRegistry()
})

test('Cron 触发的 weekly_bank_review 任务能跑通', async () => {
  const db = await createTestDb()
  await cleanupTestDb(db)

  const mockMcp = new MockMcpBridge('', {} as any, 0)
  mockMcp.on('get_pipeline_kpi', () => ({ success: true, data: { unclassified: 5 } }))
  mockMcp.on('get_unclassified_by_file', () => ({ success: true, data: { files: [] } }))

  registerTaskHandler('weekly_bank_review', async function* (task) {
    yield { stepIndex: 1, description: 'kpi', status: 'RUNNING' }
    const kpi = await mockMcp.call('get_pipeline_kpi', { brand: null }, task.userId)
    yield { stepIndex: 1, status: 'DONE', result: kpi.data }

    yield { stepIndex: 2, description: 'files', status: 'RUNNING' }
    const files = await mockMcp.call('get_unclassified_by_file', {}, task.userId)
    yield { stepIndex: 2, status: 'DONE', result: files.data }
  })

  const scheduler = new TaskScheduler(db, { push: async () => {} } as any, mockMcp as any, 1)
  scheduler.start()

  const taskId = await scheduler.enqueue({
    taskType: 'weekly_bank_review',
    input: {},
    triggeredBy: 'system',
  })

  // 轮询直到完成
  let task: any
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    task = await scheduler.getStatus(taskId)
    if (task.status === 'DONE' || task.status === 'FAILED') break
  }

  assert.strictEqual(task.status, 'DONE')

  const { rows: steps } = await db.query(
    'SELECT * FROM agent.task_steps WHERE task_id = $1 ORDER BY step_index',
    [taskId],
  )
  assert.strictEqual(steps.length, 2)
  assert.strictEqual(steps[0].status, 'DONE')

  await db.end()
})
```

## 4. E2E 测试 (Playwright + 真实 dev server)

```typescript
// test/e2e/chat-flow.test.ts (Playwright)

import { test, expect } from '@playwright/test'

test('B 用户在 ChatDrawer 问"上周怎么样", Agent 调 skill 答出来', async ({ page }) => {
  // 前置: 启动 dev server, 准备 mock 数据
  // (用 test fixture, 不在 test 内部起)

  await page.goto('http://localhost:4100/login')
  await page.fill('[name=email]', 'analyst@wdg.com')
  await page.fill('[name=password]', 'test123')
  await page.click('button[type=submit]')

  await page.goto('http://localhost:4100/u/dashboard')

  // 打开 ChatDrawer
  await page.keyboard.press('Control+K')

  // 输入问题
  await page.fill('[data-testid=chat-input]', '上周怎么样')
  await page.press('[data-testid=chat-input]', 'Enter')

  // 等待 Agent 回应 (流式)
  await expect(page.locator('[data-testid=chat-bubble-assistant]')).toContainText('未分类', { timeout: 30_000 })

  // 应该有 tool_call 折叠块
  await expect(page.locator('[data-testid=tool-call]')).toBeVisible()
})
```

**注意**: E2E 必须用真 LLM (Anthropic API), 慢, 但只有 1-2 个, 跑通就行。

## 5. CI 跑哪些

```yaml
# .github/workflows/agent-tests.yml
- name: Lint
  run: cd agent && npm run lint
- name: Type check
  run: cd agent && npx tsc --noEmit
- name: Unit tests
  run: cd agent && npm test
- name: Integration tests
  run: cd agent && npm run test:integration
- name: E2E tests (only on main)
  if: github.ref == 'refs/heads/main'
  run: cd ui && npx playwright test test/e2e/
```

**PR 必跑**: Lint + Type + Unit (秒级)
**Merge 跑**: + Integration (5-10 秒)
**Main 跑**: + E2E (1-2 分钟, 用真 LLM)

## 6. 关键不变量

| 项 | 保证方式 |
|---|---|
| LLM 输出稳定 | Mock 全部 LLM 调用, 不依赖真实 API |
| MCP 调用隔离 | Mock McpBridge, 不打真实 /api/mcp |
| DB 隔离 | 每次测试用 pg-mem 或独立 schema, 测试完 truncate |
| 时间确定性 | 不用 `setTimeout` 真实等, 用 sinon fake timers |
| 异步可测 | 所有 handler 都是 AsyncGenerator / async function, 不用 callback |

## 7. 覆盖率目标

| 模块 | 目标覆盖率 |
|---|---|
| ConfigStore | 100% (纯函数, 简单) |
| SkillRegistry | 90% (loader 涉及 fs, 难全覆盖) |
| McpBridge | 85% |
| TaskScheduler | 80% (核心路径全测) |
| AgentRunner | 70% (LLM 循环难测, 测主要分支即可) |
| Channel | 70% |
| ConversationManager | 80% |
| **总体** | **75%** |

## 8. 这个组件你看什么

- **核心挑战是 LLM 和 MCP 的 mock** —— 给出了具体实现 (MockAnthropic / MockMcpBridge)
- **3 层测试金字塔**: 单元 50-100 个, 集成 5-10 个, E2E 1-2 个
- **pg-mem 跑集成测试**, 不需要真 DB, 快
- **E2E 必须用真 LLM** —— 只有 1-2 个, 跑通真实链路
- **覆盖率 75% 目标** —— 务实, 不追求 100%
