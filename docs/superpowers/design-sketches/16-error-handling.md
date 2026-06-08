# WDG v1 — 错误处理 + 重试 + 优雅降级

> v0: /api/chat/route.ts 里 try/catch + 几个错误码判断, 没系统化
> v1: 5 类错误源, 每类有明确的处理策略 + 用户感知 + 审计/告警

## 1. 错误源分类

| 来源 | 例子 | 频率 | 严重性 |
|---|---|---|---|
| **A. LLM 调用失败** | 401 鉴权失败 / 429 限流 / 5xx 服务端错误 | 中 | 高 |
| **B. MCP 调用失败** | tool 不存在 / 参数错 / DB 视图未就绪 / 业务异常 | 高 | 中 |
| **C. 任务执行失败** | handler 抛异常 / LLM 循环死循环 / DB 写失败 | 中 | 中 |
| **D. 鉴权 / 权限失败** | 用户没登录 / 非 admin 调 admin API / 跨用户访问 | 低 | 高 |
| **E. 系统级失败** | DB 连接断 / 磁盘满 / Anthropic SDK 初始化失败 | 极低 | 致命 |

## 2. 统一错误类型

```typescript
// agent/src/errors.ts

export class AgentError extends Error {
  constructor(
    public code: string,            // 'LLM_RATE_LIMIT' / 'MCP_VIEW_NOT_READY' / ...
    message: string,
    public retryable: boolean,
    public cause?: Error,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

// A. LLM 错误
export class LlmError extends AgentError {
  constructor(code: 'LLM_AUTH' | 'LLM_RATE_LIMIT' | 'LLM_OVERLOADED' | 'LLM_TIMEOUT' | 'LLM_BAD_REQUEST', message: string, retryable: boolean, cause?: Error) {
    super(`LLM_${code}`, message, retryable, cause)
  }
}

// B. MCP 错误
export class McpError extends AgentError {
  constructor(code: 'MCP_TOOL_NOT_FOUND' | 'MCP_BAD_ARGS' | 'MCP_VIEW_NOT_READY' | 'MCP_DB_ERROR' | 'MCP_PERMISSION', message: string, retryable: boolean, cause?: Error) {
    super(`MCP_${code}`, message, retryable, cause)
  }
}

// C. 任务错误
export class TaskError extends AgentError {
  constructor(code: 'TASK_HANDLER_NOT_FOUND' | 'TASK_STEP_FAILED' | 'TASK_CANCELLED' | 'TASK_TIMEOUT', message: string, retryable: boolean, cause?: Error) {
    super(`TASK_${code}`, message, retryable, cause)
  }
}

// D. 鉴权错误
export class AuthError extends AgentError {
  constructor(code: 'AUTH_REQUIRED' | 'AUTH_FORBIDDEN' | 'AUTH_INVALID_SESSION', message: string) {
    super(code, message, false)
  }
}

// E. 系统错误
export class SystemError extends AgentError {
  constructor(code: 'SYS_DB_DOWN' | 'SYS_DISK_FULL' | 'SYS_INIT_FAILED', message: string) {
    super(code, message, false)
  }
}
```

## 3. 每类错误的处理策略

### 3.1 LLM 调用失败 (A)

| code | 触发 | 策略 | 重试 | 用户感知 |
|---|---|---|---|---|
| `LLM_AUTH` | 401 (apiKey 错) | 立即停 | ❌ | "Agent 配置错误, 请联系 admin" + 告警 |
| `LLM_RATE_LIMIT` | 429 | 等 30s | ✅ ×3 | 进度条停顿, 不报错 |
| `LLM_OVERLOADED` | 529 / 503 | 等 10s | ✅ ×3 | 进度条停顿, 不报错 |
| `LLM_TIMEOUT` | 30s 无响应 | 重连 | ✅ ×2 | "Agent 响应慢, 已重试" |
| `LLM_BAD_REQUEST` | 400 (prompt 太大) | 截断 history, 重试 | ✅ ×1 | "对话太长, 已压缩" |

```typescript
// agent/src/agent/runner.ts (片段)
async callLlmWithRetry(params: Anthropic.MessageCreateParams): Promise<Anthropic.Message> {
  const cfg = this.deps.configStore.get()
  let lastErr: any

  for (let attempt = 0; attempt <= cfg.params.mcpRetryMaxAttempts; attempt++) {
    try {
      return await this.deps.anthropic.messages.create(params)
    } catch (e: any) {
      lastErr = e
      const code = mapAnthropicError(e)

      if (code === 'LLM_AUTH') {
        // 立即停, 不重试
        throw new LlmError('LLM_AUTH', 'Invalid API key', false, e)
      }
      if (code === 'LLM_RATE_LIMIT') {
        await sleep(30_000)
        continue
      }
      if (code === 'LLM_OVERLOADED') {
        await sleep(10_000 * (attempt + 1))
        continue
      }
      if (code === 'LLM_TIMEOUT') {
        await sleep(2_000)
        continue
      }
      if (code === 'LLM_BAD_REQUEST' && /prompt is too long/.test(e.message)) {
        // 截断 history 再试
        params.messages = truncateHistory(params.messages, 0.5)
        continue
      }
      // 其他: 不可恢复
      throw new LlmError(code, e.message, false, e)
    }
  }
  throw new LlmError('LLM_RETRY_EXHAUSTED', `Tried ${cfg.params.mcpRetryMaxAttempts + 1} times`, true, lastErr)
}
```

### 3.2 MCP 调用失败 (B)

| code | 触发 | 策略 | 重试 | 用户感知 |
|---|---|---|---|---|
| `MCP_TOOL_NOT_FOUND` | tool 不在 /list | 不重试, 把错误回灌给 LLM | ❌ | 折叠块 "tool not found" (LLM 会自己换工具) |
| `MCP_BAD_ARGS` | 参数错 (缺字段 / 类型错) | 回灌给 LLM, 让 LLM 重试 | ✅ (让 LLM 修) | 折叠块 "参数错" |
| `MCP_VIEW_NOT_READY` | '42P01' 视图不存在 | 回灌, LLM 可选忽略或告知用户 | ❌ | 折叠块 "view not ready" |
| `MCP_DB_ERROR` | DB 异常 / 超时 | 指数退避 | ✅ ×2 | 进度条停顿 |
| `MCP_PERMISSION` | 401/403 | 不重试, 报错 | ❌ | "权限不足" |

```typescript
// agent/src/mcp/bridge.ts (片段, 接 v0 的实现)
async call(toolName: string, args: any, userId: string): Promise<McpCallResult> {
  for (let attempt = 0; attempt <= this.retryMax; attempt++) {
    try {
      const res = await this.callOnce(toolName, args, userId)
      if (res.success) return res

      // 业务错误, 看类型
      const code = mapMcpError(res.error)
      if (code === 'MCP_TOOL_NOT_FOUND' || code === 'MCP_PERMISSION') {
        return { ...res, retryable: false }
      }
      if (code === 'MCP_BAD_ARGS') {
        // 让 LLM 修, 不在 mcp-bridge 层重试
        return { ...res, retryable: true, error: `Args invalid: ${res.error}. Please check parameters.` }
      }
      if (code === 'MCP_DB_ERROR') {
        await sleep(1000 * (attempt + 1))
        continue
      }
      return res
    } catch (e: any) {
      if (attempt >= this.retryMax) {
        return { success: false, data: null, error: e.message, retryable: true }
      }
      await sleep(1000 * (attempt + 1))
    }
  }
}
```

**关键设计**:
- MCP 错误**回灌给 LLM**, 不在 AgentRunner 层硬处理
- LLM 看到 tool_result is_error=true 后, **自己决定** 改参数 / 换工具 / 告知用户
- 这就是 "LLM 是工作流执行者" 的体现 (Y 方案的价值)

### 3.3 任务执行失败 (C)

| 失败点 | 策略 |
|---|---|
| Handler 抛异常 | 写 task.error, status=FAILED, 推 UI 通知 |
| 单 step 失败 | status=FAILED, 后续 step SKIPPED, status=PARTIAL, 推 UI 标黄 |
| LLM 循环超过 maxToolChainDepth | 任务 abort, 给个"超出深度"提示 |
| Worker 进程崩溃 | DB 状态 = RUNNING 但 worker 已死, 启动时 cleanup (status=FAILED + error=worker_died) |

```typescript
// agent/src/tasks/scheduler.ts (片段, 接之前的实现)
private async runTask(task: Task, workerId: number) {
  const handler = getHandler(task.taskType)
  if (!handler) {
    await this.failTask(task, new TaskError('TASK_HANDLER_NOT_FOUND', `No handler: ${task.taskType}`, false))
    return
  }

  let lastFailedStep = -1
  try {
    for await (const update of handler(task)) {
      // 1. 记 step
      await this.recordStep(task, update)

      // 2. 推 UI
      await this.notifyStep(task, update)

      // 3. 失败处理
      if (update.status === 'FAILED') {
        lastFailedStep = update.stepIndex
        // 不 break — 让 handler 自己决定要不要继续
      }
    }

    // 任务完成, 看是否带失败
    if (lastFailedStep > 0) {
      await this.completeTask(task, { partial: true, failedStep: lastFailedStep }, 'PARTIAL')
    } else {
      await this.completeTask(task, {}, 'DONE')
    }
  } catch (e: any) {
    await this.failTask(task, e instanceof AgentError ? e : new TaskError('TASK_STEP_FAILED', e.message, false, e))
  }
}

// 启动时清理 zombie
async function cleanupZombieTasks(db: Pool) {
  await db.query(`
    UPDATE agent.tasks
    SET status = 'FAILED',
        error = '{"code": "TASK_WORKER_DIED", "message": "Worker crashed, marking failed"}',
        finished_at = NOW()
    WHERE status = 'RUNNING'
      AND started_at < NOW() - INTERVAL '10 minutes'
  `)
}
```

### 3.4 鉴权失败 (D)

```typescript
// agent/src/api/middleware/auth.ts
export async function requireAuth(req, reply) {
  const userId = req.headers['x-wdg-user-id']
  if (!userId) {
    throw new AuthError('AUTH_REQUIRED', 'Login required')
  }
  req.userId = userId
}

export async function requireAdmin(req, reply) {
  await requireAuth(req, reply)
  const role = req.headers['x-wdg-user-role']
  if (role !== 'admin') {
    throw new AuthError('AUTH_FORBIDDEN', 'Admin only')
  }
}
```

**统一错误响应** (Fastify error handler):
```typescript
// agent/src/api/error-handler.ts
app.setErrorHandler((err, req, reply) => {
  if (err instanceof AgentError) {
    const status = err instanceof AuthError
      ? (err.code === 'AUTH_REQUIRED' ? 401 : 403)
      : (err instanceof SystemError ? 503 : 500)
    reply.code(status).send({
      error: err.code,
      message: err.message,
      retryable: err.retryable,
    })
  } else {
    // 未知错误, 不暴露详情
    reply.code(500).send({ error: 'INTERNAL', message: 'Internal error' })
    console.error('Unknown error', err)
  }
})
```

### 3.5 系统级失败 (E)

**最危险的一类, 出现就死**:
- DB 连不上 → Agent 起不来, Docker 反复重启
- 磁盘满 → 写不进去, 任务卡死
- Anthropic SDK 初始化失败 → 启动失败

**策略**:
- 启动时**主动探活** (DB ping / SDK init), 失败就退出, 让 Docker 重启
- 运行时 DB 失联 → 所有写操作 fail-fast, LLM 调用降级为 "Agent 暂时无法保存, 请稍后再试"
- 不试图"自动恢复", **fail loud, fail fast**

```typescript
// agent/src/server.ts (片段)
// 启动探活
async function startupCheck() {
  // DB
  await db.query('SELECT 1')
  // Anthropic SDK
  const client = new Anthropic({ apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY })
  // (不真发请求, 初始化就够了)
  console.log('[startup] all checks passed')
}

process.on('unhandledRejection', (e) => {
  console.error('[FATAL] unhandledRejection', e)
  process.exit(1)  // 让 Docker 重启
})
```

## 4. 用户感知 (UX 侧统一)

每类错误的 UI 反馈:

| 错误 | UI 显示 | 恢复方式 |
|---|---|---|
| LLM 临时问题 | 进度条停顿, 不报错 | 自动重试 |
| LLM_AUTH / 鉴权 | "Agent 配置错误, 请联系 admin" | 人工修 |
| MCP 工具错 | 折叠块 "X 工具失败" | LLM 自动换工具 |
| 任务失败 | `/u/notifications` 红点 + 详情 | 一键 rerun |
| 系统级 | 整页 "Agent 服务不可用" | 人工运维 |

```typescript
// agent/src/channels/web.ts (片段, 错误推送)
async send(msg: OutgoingMsg) {
  if (msg.type === 'error') {
    // 推一条 "system 错误" 块, 而不是 tool_call 块
    ws.send(JSON.stringify({
      type: 'system_error',
      payload: {
        code: msg.payload.code,
        message: msg.payload.message,
        retryable: msg.payload.retryable,
        hint: getHint(msg.payload.code),  // '请联系 admin' / '正在重试' / ...
      },
    }))
  }
}

function getHint(code: string): string {
  const HINTS = {
    LLM_AUTH: '请联系管理员检查 API key',
    MCP_PERMISSION: '当前用户无权限',
    TASK_FAILED: '可在 /u/notifications 重新提交',
    SYS_DB_DOWN: 'Agent 服务暂时不可用, 已通知运维',
  }
  return HINTS[code] ?? '请稍后重试'
}
```

## 5. 审计 + 告警

```typescript
// agent/src/audit/logger.ts
export async function logError(db: Pool, err: AgentError, ctx: {
  userId?: string
  conversationId?: string
  taskId?: string
  toolName?: string
}) {
  await db.query(`
    INSERT INTO agent.audit_log (user_id, conversation_id, task_id, action, payload)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    ctx.userId ?? null,
    ctx.conversationId ?? null,
    ctx.taskId ?? null,
    `error:${err.code}`,
    JSON.stringify({
      message: err.message,
      retryable: err.retryable,
      cause: err.cause?.message,
      ...ctx,
    }),
  ])

  // 严重错误 → 告警
  if (err instanceof SystemError || err.code === 'LLM_AUTH') {
    await alertAdmin(err)  // 邮件 / 钉钉 (v2)
  }
}
```

## 6. 优雅降级 (降级路径)

Agent Service 不可用时:

```
场景 1: Agent Service 进程挂了
  → Next.js 的 ChatDrawer 检测 ws 断了
  → 弹条 "Agent 暂时不可用, 您可以继续浏览报表"
  → /u/notifications 显示 "任务 X 未完成, 将在 Agent 恢复后继续"
  → /api/chat (v0 降级) 完全不保留, 因为 v0 chat 跟 Agent 共用 LLM, 一起挂

场景 2: Anthropic API 挂
  → Agent Service 启动时 + 定期 ping 检测
  → 自动 fail-fast 标记 "LLM 服务异常"
  → 所有 WS 推 "Agent LLM 暂时不可用, 预计 X 分钟恢复"
  → MCP 工具还能直接调 (虽然用户看不到, 但 task 能跑过 step)

场景 3: DB 挂
  → Agent Service 启动失败 (fail-fast)
  → Docker 反复重启
  → Next.js 完全独立, 报表/审批/Rules CRUD 不受影响 (它们用同一个 DB 实例, 也会挂, 但不归 Agent 管)
```

## 7. 这个组件你看什么

- **5 类错误源, 各自有明确处理策略** —— 不再是"哪里 try/catch 一下"
- **MCP 错误回灌给 LLM, 不在 AgentRunner 硬处理** —— 体现 Y 方案"LLM 是工作流执行者"
- **任务用 AsyncGenerator 自然支持 step 失败 + PARTIAL 状态**
- **系统级错误 fail loud, fail fast, 不试图自动恢复**
- **审计 + 告警统一进 agent.audit_log**
- **优雅降级**: Agent 挂时 Next.js 还能用, MCP 工具还能调, 只是 LLM 路径不可用
