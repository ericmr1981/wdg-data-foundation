// agent/src/tasks/scheduler.test.ts
import { test, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import { TaskScheduler } from './scheduler.ts'
import { registerTaskHandler } from './registry.ts'
import { createTestDb, cleanupTestDb } from '../../test/helpers/mock-db.ts'
import { MockMcpBridge } from '../../test/helpers/mock-mcp.ts'
import { registerWeeklyBankReview } from './handlers/weekly-bank-review.ts'

let pool: any
let mcp: MockMcpBridge
let scheduler: TaskScheduler
let notifications: any[]

before(async () => {
  pool = await createTestDb()
  mcp = new MockMcpBridge()
  registerWeeklyBankReview(mcp)
  notifications = []
  scheduler = new TaskScheduler(pool, { push: async (n) => { notifications.push(n) } }, mcp as any, 1)
})

after(async () => {
  await pool.end()
})

test('enqueue + run a simple task to completion', async () => {
  await cleanupTestDb(pool)
  registerTaskHandler('test_simple', async function* (_task) {
    yield { stepIndex: 1, description: 'step 1', status: 'RUNNING' }
    yield { stepIndex: 1, description: 'step 1', status: 'DONE', result: { ok: true } }
  })

  const taskId = await scheduler.enqueue({
    taskType: 'test_simple', input: {}, triggeredBy: 'test',
  })

  scheduler.start()

  let status: any
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    status = await scheduler.getStatus(taskId)
    if (status && ['DONE', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(status.status)) break
  }

  assert.equal(status.status, 'DONE')

  const { rows: steps } = await pool.query(
    `SELECT * FROM agent.task_steps WHERE task_id = $1 ORDER BY step_index`, [taskId],
  )
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'DONE')
})

test('weekly_bank_review handler runs', async () => {
  await cleanupTestDb(pool)
  mcp.on('get_pipeline_kpi', () => ({ success: true, data: { unclassified: 10 }, retryable: false }))
  mcp.on('get_unclassified_by_file', () => ({ success: true, data: { files: [] }, retryable: false }))

  const taskId = await scheduler.enqueue({
    taskType: 'weekly_bank_review', input: { brand: 'yufeng' }, triggeredBy: 'cron',
  })

  let status: any
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    status = await scheduler.getStatus(taskId)
    if (status && ['DONE', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(status.status)) break
  }

  assert.equal(status.status, 'DONE')
  const { rows: steps } = await pool.query(
    `SELECT * FROM agent.task_steps WHERE task_id = $1 ORDER BY step_index`, [taskId],
  )
  assert.equal(steps.length, 2)
})
