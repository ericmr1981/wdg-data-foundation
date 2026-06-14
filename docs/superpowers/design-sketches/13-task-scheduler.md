# WDG v1 — Task Scheduler (DB-backed queue + 状态机)

> 长任务(超过单次对话时长)走任务队列, 不阻塞 Channel, 支持进度推送、取消、重试。
> v0 没有任务队列概念; v1 是真正新设计的部分。
> 不引入 Redis/Celery — 沿用现有 PG, 用 `SELECT ... FOR UPDATE SKIP LOCKED` 做并发。

## 1. 状态机

```
        ┌──────┐
        │ NEW  │  ← 入队时初始
        └───┬──┘
            │ enqueue()
            ▼
        ┌────────┐
        │ QUEUED │  ← 在队列里, 等待 worker
        └───┬────┘
            │ worker pick (FOR UPDATE SKIP LOCKED)
            ▼
        ┌────────┐
        │ RUNNING │  ← 正在执行
        └───┬────┘
            │
     ┌──────┼──────┬──────────┐
     ▼      ▼      ▼          ▼
  ┌────┐ ┌──────┐ ┌──────┐ ┌────────┐
  │DONE│ │FAILED│ │CANCEL│ │PARTIAL │  ← 终态
  └────┘ └──────┘ └──────┘ └────────┘
   成功   异常结束  主动取消  部分完成, 需人介入
```

## 2. 数据结构

```typescript
// agent/src/tasks/types.ts

export type TaskStatus =
  | 'NEW' | 'QUEUED' | 'RUNNING'
  | 'DONE' | 'FAILED' | 'CANCELLED' | 'PARTIAL'

export type StepStatus =
  | 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'

// 任务定义 (由调用方传入)
export interface TaskDefinition<T = any> {
  taskType: string                  // 'weekly_bank_review'
  input: T                          // 任务参数
  triggeredBy: string               // userId or 'system'
  parentTaskId?: string             // 子任务链
  conversationId?: string           // 关联的 UI 会话 (进度推送目标)
}

// 任务运行时 (DB 里的 row)
export interface Task {
  taskId: string
  parentTaskId: string | null
  conversationId: string | null
  userId: string | null
  taskType: string
  input: any
  status: TaskStatus
  progress: number                  // 0-100
  result: any | null
  error: { message: string; stack?: string } | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

// 步骤运行时
export interface TaskStep {
  stepId: number
  taskId: string
  stepIndex: number
  description: string
  status: StepStatus
  startedAt: Date | null
  finishedAt: Date | null
  result: any | null
  error: any | null
}
```

## 3. 任务类型注册表

```typescript
// agent/src/tasks/registry.ts

import { TaskDefinition, Task } from './types'

// 任务执行函数签名
export type TaskHandler<T = any> = (task: Task) => AsyncGenerator<TaskStepUpdate>

// 一个 step 完成的回调
export interface TaskStepUpdate {
  stepIndex: number
  description: string
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'
  result?: any
  error?: string
}

const handlers = new Map<string, TaskHandler>()

export function registerTaskHandler(type: string, handler: TaskHandler) {
  handlers.set(type, handler)
}

export function getHandler(type: string): TaskHandler | null {
  return handlers.get(type) ?? null
}
```

### v1 默认注册 2 个任务类型 (示例)

```typescript
// agent/src/tasks/handlers/weekly-bank-review.ts

import { registerTaskHandler } from '../registry'
import { TaskStepUpdate } from '../types'

registerTaskHandler('weekly_bank_review', async function* (task): AsyncGenerator<TaskStepUpdate> {
  const brand = task.input.brand

  // Step 1
  yield { stepIndex: 1, description: '获取上周 KPI', status: 'RUNNING' }
  const kpi = await mcpBridge.call('get_pipeline_kpi', { brand }, task.userId)
  if (!kpi.success) yield { stepIndex: 1, status: 'FAILED', error: kpi.error }
  yield { stepIndex: 1, status: 'DONE', result: kpi.data }

  // Step 2
  yield { stepIndex: 2, description: '拉取未分类文件', status: 'RUNNING' }
  const files = await mcpBridge.call('get_unclassified_by_file', { limit: 10, brand }, task.userId)
  yield { stepIndex: 2, status: 'DONE', result: files.data }

  // ... Step 3-5
})

// monthly_financial_summary, bulk_propose_rules, cashflow_anomaly 同理
```

## 4. Scheduler 实现

```typescript
// agent/src/tasks/scheduler.ts

import { Pool } from 'pg'
import { Task, TaskDefinition, TaskStatus } from './types'
import { getHandler } from './registry'
import { Notifier } from '../notifications/notifier'

export class TaskScheduler {
  constructor(
    private db: Pool,
    private notifier: Notifier,
    private mcpBridge: McpBridge,
    private workers: number = 2,           // 默认 2 个 worker 并发
  ) {}

  // ─── 入队 ────────────────────────────────

  async enqueue(def: TaskDefinition): Promise<string> {
    const { rows } = await this.db.query(`
      INSERT INTO agent.tasks
        (status, task_type, input, user_id, parent_task_id, conversation_id)
      VALUES
        ('QUEUED', $1, $2, $3, $4, $5)
      RETURNING task_id
    `, [
      def.taskType,
      JSON.stringify(def.input),
      def.triggeredBy,
      def.parentTaskId ?? null,
      def.conversationId ?? null,
    ])
    return rows[0].task_id
  }

  // ─── Worker 主循环 ───────────────────────

  start() {
    for (let i = 0; i < this.workers; i++) {
      this.workerLoop(i)
    }
  }

  private async workerLoop(workerId: number) {
    while (true) {
      const task = await this.pickTask()
      if (!task) {
        await sleep(1000)   // 没有任务, 等 1s
        continue
      }
      await this.runTask(task, workerId)
    }
  }

  // ─── 抢任务 (核心: FOR UPDATE SKIP LOCKED) ──

  private async pickTask(): Promise<Task | null> {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(`
        UPDATE agent.tasks
        SET status = 'RUNNING', started_at = NOW()
        WHERE task_id = (
          SELECT task_id FROM agent.tasks
          WHERE status = 'QUEUED'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
      `)
      await client.query('COMMIT')
      return rows[0] ?? null
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  // ─── 执行任务 ───────────────────────────

  private async runTask(task: Task, workerId: number) {
    const handler = getHandler(task.taskType)
    if (!handler) {
      await this.failTask(task, `No handler for ${task.taskType}`)
      return
    }

    let stepCount = 0
    let lastStepIndex = 0

    try {
      for await (const update of handler(task)) {
        lastStepIndex = update.stepIndex
        await this.recordStep(task, update)
        if (update.status === 'DONE' || update.status === 'FAILED') stepCount++

        // 推送给 UI (如果有关联 conversation)
        if (task.conversationId) {
          this.notifier.push(task.conversationId, {
            type: 'task_update',
            payload: {
              taskId: task.task_id,
              step: update.stepIndex,
              description: update.description,
              status: update.status,
              progress: this.estimateProgress(update.stepIndex),
            },
          })
        }
      }

      await this.completeTask(task, { steps: stepCount, lastStep: lastStepIndex })
    } catch (e: any) {
      await this.failTask(task, e.message ?? String(e))
    }
  }

  private estimateProgress(stepIdx: number): number {
    // v1 简单: 假设每个任务 ≤ 10 步
    return Math.min(100, Math.round((stepIdx / 10) * 100))
  }

  private async recordStep(task: Task, update: TaskStepUpdate) {
    await this.db.query(`
      INSERT INTO agent.task_steps
        (task_id, step_index, description, status, started_at, finished_at, result, error)
      VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
      ON CONFLICT (task_id, step_index) DO UPDATE SET
        status = EXCLUDED.status,
        finished_at = EXCLUDED.finished_at,
        result = EXCLUDED.result,
        error = EXCLUDED.error
    `, [
      task.task_id,
      update.stepIndex,
      update.description,
      update.status,
      update.status === 'DONE' || update.status === 'FAILED' ? new Date() : null,
      update.result ? JSON.stringify(update.result) : null,
      update.error ?? null,
    ])
  }

  private async completeTask(task: Task, summary: any) {
    await this.db.query(`
      UPDATE agent.tasks
      SET status = 'DONE', progress = 100, result = $2, finished_at = NOW()
      WHERE task_id = $1
    `, [task.task_id, JSON.stringify(summary)])

    await this.notifier.push(task.conversationId ?? null, {
      type: 'task_update',
      payload: { taskId: task.task_id, status: 'DONE', result: summary },
    })
  }

  private async failTask(task: Task, errorMsg: string) {
    await this.db.query(`
      UPDATE agent.tasks
      SET status = 'FAILED', error = $2, finished_at = NOW()
      WHERE task_id = $1
    `, [task.task_id, JSON.stringify({ message: errorMsg })])

    await this.notifier.push(task.conversationId ?? null, {
      type: 'task_update',
      payload: { taskId: task.task_id, status: 'FAILED', error: errorMsg },
    })
  }

  // ─── 取消 / 状态查询 ─────────────────────

  async cancel(taskId: string): Promise<void> {
    // 状态 = QUEUED → 直接改 CANCELLED
    // 状态 = RUNNING → 标记 CANCELLED, worker 下一轮检查后退出
    await this.db.query(`
      UPDATE agent.tasks
      SET status = 'CANCELLED', finished_at = NOW()
      WHERE task_id = $1 AND status IN ('QUEUED', 'RUNNING')
    `, [taskId])
  }

  async getStatus(taskId: string): Promise<Task | null> {
    const { rows } = await this.db.query(`SELECT * FROM agent.tasks WHERE task_id = $1`, [taskId])
    return rows[0] ?? null
  }

  async listRecent(userId: string, limit = 20): Promise<Task[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM agent.tasks
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, limit])
    return rows
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
```

## 5. 进度推送 → UI

```typescript
// agent/src/notifications/notifier.ts (片段)
// Notifier 是个抽象, WebChannel 实现走 WS, 未来 DingTalkChannel 走钉钉

export interface Notifier {
  push(conversationId: string | null, msg: { type: string; payload: any }): Promise<void>
}

export class WebNotifier implements Notifier {
  constructor(private wsChannel: WebChannel) {}

  async push(conversationId: string | null, msg) {
    if (!conversationId) return
    await this.wsChannel.send({
      channelId: 'web',
      conversationId,
      type: msg.type,
      payload: msg.payload,
    })
  }
}
```

## 6. 跟 Channel / AgentRunner 的关系

```
Cron tick
   │
   ▼
ChannelManager.onIncoming({ channelId: 'cron', ... })
   │
   ▼
TaskScheduler.enqueue({ taskType: 'weekly_bank_review' })
   │
   ▼ (worker 抢)
TaskScheduler.runTask()
   │
   ├─ for await (handler(task))   ← handler 是 AsyncGenerator
   │    yield { stepIndex, status, result }   每步都 yield 一次
   │
   ├─ recordStep()         ← 写 agent.task_steps
   ├─ notifier.push()      ← 推 WS (给 UI 看进度)
   │
   ▼
completeTask() / failTask()    ← 写 agent.tasks.status
                                  推最终状态给 UI
```

**关键**: handler 用 `AsyncGenerator` (不是返回 Promise), 让每一步都能单独 yield, 既能写库又能推 UI。

## 7. 跟 v0 的兼容性

**没有 v0 对应物** —— v0 没有任务队列,所有逻辑都在 `/api/chat/route.ts` 一个请求里跑完。

v1 是新设计,工作量: ~1 周 (含 DDL + scheduler + 2 个 handler)。

## 8. 这个组件你看什么

- **DB-backed queue 用 `FOR UPDATE SKIP LOCKED`** — 不引 Redis, 沿用 PG
- **任务 handler 用 AsyncGenerator** — 每步 yield, 自然支持进度推送
- **不阻塞 Channel** — enqueue 后立刻返回, 后台 worker 跑
- **进度推送通过 Notifier 抽象** — v1 走 WS, v2 加钉钉
- **取消 / 失败 / 重试** 状态机覆盖, v1 不做自动重试 (人审后手动 rerun_match_by_file)
