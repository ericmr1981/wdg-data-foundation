# WDG v1 — 监控 + 告警 + 审计

> v0: 没系统化监控, 主要靠 docker logs + 偶发手动查 PG
> v1: Agent Service 自己的指标 + 复用既有 ops.pipeline_run 模式

## 1. 三层可观测性

```
                    ┌──────────────────────────┐
                    │   ① 业务指标 (用户视角)    │
                    │   /u/dashboard 看          │
                    └──────────────────────────┘
                                  ▲
                    ┌──────────────────────────┐
                    │   ② 系统指标 (运维视角)    │
                    │   Prometheus / Grafana     │
                    └──────────────────────────┘
                                  ▲
                    ┌──────────────────────────┐
                    │   ③ 审计 (合规视角)       │
                    │   agent.audit_log          │
                    └──────────────────────────┘
```

## 2. 业务指标 (①)

**在 /u/dashboard 加一个 "Agent 健康" 卡片**:

| 指标 | 来源 | 展示 |
|---|---|---|
| 今日 LLM 调用次数 | `agent.audit_log WHERE action='llm_call' AND created_at > today` | 数字 |
| 今日任务完成数 | `agent.tasks WHERE status='DONE' AND finished_at > today` | 数字 |
| Cron 任务最新状态 | `agent.tasks WHERE task_type='weekly_bank_review' ORDER BY created_at DESC LIMIT 1` | 状态 + 时间 |
| 未读通知数 | 略 | 红点 |

## 3. 系统指标 (②) — Prometheus 风格

### 3.1 暴露 metrics endpoint

```typescript
// agent/src/metrics/server.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client'

const registry = new Registry()

// ─── LLM 指标 ───────────────────────
export const llmCallTotal = new Counter({
  name: 'agent_llm_call_total',
  help: 'Total LLM calls',
  labelNames: ['model', 'status'],  // 'success' | 'error' | 'retry'
  registers: [registry],
})

export const llmLatency = new Histogram({
  name: 'agent_llm_latency_seconds',
  help: 'LLM call latency',
  labelNames: ['model'],
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [registry],
})

export const llmTokens = new Counter({
  name: 'agent_llm_tokens_total',
  help: 'Tokens used',
  labelNames: ['model', 'type'],  // 'input' | 'output' | 'thinking'
  registers: [registry],
})

// ─── MCP 指标 ───────────────────────
export const mcpCallTotal = new Counter({
  name: 'agent_mcp_call_total',
  help: 'MCP tool calls',
  labelNames: ['tool', 'status'],
  registers: [registry],
})

export const mcpLatency = new Histogram({
  name: 'agent_mcp_latency_seconds',
  help: 'MCP call latency',
  labelNames: ['tool'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
  registers: [registry],
})

// ─── 任务指标 ───────────────────────
export const taskStatusGauge = new Gauge({
  name: 'agent_tasks_by_status',
  help: 'Tasks by status',
  labelNames: ['status'],
  registers: [registry],
})

export const taskDuration = new Histogram({
  name: 'agent_task_duration_seconds',
  help: 'Task total duration',
  labelNames: ['task_type'],
  buckets: [10, 30, 60, 300, 600, 1800],
  registers: [registry],
})

// ─── 系统指标 ───────────────────────
export const activeWebsockets = new Gauge({
  name: 'agent_websockets_active',
  help: 'Active WebSocket connections',
  registers: [registry],
})

// 暴露 /metrics 端点
app.get('/metrics', async (req, reply) => {
  reply.type('text/plain').send(await registry.metrics())
})
```

### 3.2 在 AgentRunner / McpBridge / TaskScheduler 集成

```typescript
// agent/src/agent/runner.ts
import { llmCallTotal, llmLatency, llmTokens } from '../metrics/server'

private async callLlmWithRetry(params) {
  const end = llmLatency.startTimer({ model: params.model })
  try {
    const res = await this.deps.anthropic.messages.create(params)
    llmCallTotal.inc({ model: params.model, status: 'success' })
    llmTokens.inc({ model: params.model, type: 'input' }, res.usage.input_tokens)
    llmTokens.inc({ model: params.model, type: 'output' }, res.usage.output_tokens)
    return res
  } catch (e) {
    llmCallTotal.inc({ model: params.model, status: 'error' })
    throw e
  } finally {
    end()
  }
}
```

### 3.3 Grafana Dashboard (示例)

```
┌─────────────────┬─────────────────┬─────────────────┐
│ LLM Calls       │ Error Rate      │ P95 Latency     │
│ 1,234 ↑12%      │ 2.3%            │ 4.2s            │
├─────────────────┴─────────────────┴─────────────────┤
│ LLM Calls by Model (stacked area, last 24h)         │
│ ▁▂▃▅▇█▇▅▃▂▁                                         │
├──────────────────────────────────────────────────────┤
│ MCP Tools: top 10 (bar)                              │
│ get_brand_stores     ████████████  456                │
│ get_pipeline_kpi     ████████      312                │
│ ...                                                    │
├──────────────────────────────────────────────────────┤
│ Tasks: by status (donut)                             │
│   DONE  12  ·  RUNNING 1  ·  FAILED 0                │
└──────────────────────────────────────────────────────┘
```

## 4. 告警 (Prometheus AlertManager 风格)

### 4.1 告警规则

```yaml
# /etc/prometheus/rules/agent.yml
groups:
  - name: agent
    rules:
      # LLM 错误率
      - alert: AgentLLMErrorRateHigh
        expr: |
          sum(rate(agent_llm_call_total{status="error"}[5m]))
          / sum(rate(agent_llm_call_total[5m])) > 0.05
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "Agent LLM 错误率 > 5%"

      # MCP 错误率
      - alert: AgentMcpErrorRateHigh
        expr: |
          sum(rate(agent_mcp_call_total{status="error"}[5m]))
          / sum(rate(agent_mcp_call_total[5m])) > 0.10
        for: 5m
        labels: { severity: warning }

      # 任务失败
      - alert: AgentTaskFailed
        expr: increase(agent_tasks_by_status{status="FAILED"}[1h]) > 3
        labels: { severity: critical }

      # 内存
      - alert: AgentMemoryHigh
        expr: process_resident_memory_bytes{job="agent"} > 500 * 1024 * 1024
        for: 10m
        labels: { severity: warning }

      # P95 延迟
      - alert: AgentLatencyHigh
        expr: histogram_quantile(0.95, rate(agent_llm_latency_seconds_bucket[5m])) > 30
        for: 5m
        labels: { severity: warning }
```

### 4.2 告警渠道 (v1 简陋, v2 完善)

```typescript
// agent/src/alert/sender.ts
export interface AlertSender {
  send(alert: { severity: 'info' | 'warning' | 'critical'; title: string; body: string }): Promise<void>
}

export class WebhookAlertSender implements AlertSender {
  constructor(private webhookUrl: string) {}

  async send(alert) {
    // 飞书 / 钉钉 / Slack Webhook, v1 选一个
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: `[${alert.severity}] ${alert.title}\n${alert.body}` },
      }),
    })
  }
}
```

## 5. 审计 (③) — agent.audit_log

### 5.1 写什么

```typescript
// agent/src/audit/logger.ts
export async function audit(db: Pool, event: {
  userId?: string
  conversationId?: string
  taskId?: string
  action: AuditAction
  payload: any
}) {
  await db.query(`
    INSERT INTO agent.audit_log (user_id, conversation_id, task_id, action, payload)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    event.userId ?? null,
    event.conversationId ?? null,
    event.taskId ?? null,
    event.action,
    JSON.stringify(event.payload),
  ])
}

export type AuditAction =
  | 'conversation.start'
  | 'conversation.end'
  | 'message.user'
  | 'message.assistant'
  | 'message.tool'
  | 'llm.call'
  | 'llm.retry'
  | 'mcp.call'
  | 'mcp.error'
  | 'task.enqueue'
  | 'task.start'
  | 'task.step'
  | 'task.done'
  | 'task.fail'
  | 'task.cancel'
  | 'skill.load'
  | 'config.update'
  | 'error'
```

### 5.2 谁写

| 触发点 | action | payload |
|---|---|---|
| ChannelManager 收到新消息 | `conversation.start` | { channel, user } |
| AgentRunner 调 LLM | `llm.call` | { model, input_tokens, output_tokens, duration_ms } |
| AgentRunner 调 MCP | `mcp.call` | { tool, args, success, duration_ms } |
| AgentRunner 调 LLM 重试 | `llm.retry` | { attempt, error_code } |
| AgentRunner 出错 | `error` | { code, message, stack } |
| TaskScheduler 入队 | `task.enqueue` | { task_type, input_size } |
| Task step 完成 | `task.step` | { step_index, status, duration_ms } |
| 任务完成 | `task.done` | { total_steps, duration_ms } |
| 任务失败 | `task.fail` | { error_code, message } |
| 加载 skill | `skill.load` | { skill_name, bytes } |
| Admin 改 config | `config.update` | { what, before, after } |

### 5.3 查什么 (UI)

**在 /u/notifications 页加 1 个 tab "审计日志"** (admin 可见):

```sql
-- 例子 1: 查某个用户的所有操作
SELECT created_at, action, payload
FROM agent.audit_log
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 100;

-- 例子 2: 查今天的错误
SELECT created_at, user_id, action, payload
FROM agent.audit_log
WHERE action = 'error' AND created_at > today()
ORDER BY created_at DESC;

-- 例子 3: 查某任务的 step 详情
SELECT step_index, description, status, started_at, finished_at
FROM agent.task_steps
WHERE task_id = $1
ORDER BY step_index;
```

## 6. v0 复用: ops 表

v0 已经有 `ops.pipeline_run` / `ops.pipeline_step_run` 表, 模式一样。v1 的 `agent.*` 表是 ops 的"agent 版本", 风格一致 (ops_logger.py 的 pipeline_step 跟 task_step 是同构的)。

**好处**: 后续 dashboard 工具能复用, 不用为 agent 单独做一套。

## 7. 这个组件你看什么

- **三层可观测性**: 业务 / 系统 / 审计
- **Prometheus 风格 metrics**, 暴露 `/metrics` 端点
- **告警规则用 YAML**, Prometheus AlertManager 兼容
- **审计进 agent.audit_log**, 跟 v0 的 ops.pipeline_run 模式一致
- **告警渠道 v1 简陋** (Webhook), v2 加钉钉
- **/u/notifications 加审计 tab** (admin 可见), 用户能自查
