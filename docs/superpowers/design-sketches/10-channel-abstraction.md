# WDG v1 — Channel 抽象设计

> v0 没有任何 Channel 抽象 — 只有一个 /api/chat 路由把 UI 消息转给 LLM。
> v1 我们把"消息进出"独立成 Channel 抽象, 让 Agent 能接 Web / Cron / 钉钉 / Webhook 多种来源。

## 1. 为什么需要 Channel 抽象

v0 的耦合:
```
UI ChatDrawer
   │
   ▼  fetch /api/chat (SSE)
Next.js 进程
   │
   ▼  直接调 Anthropic
LLM
```

问题:
- 只能从 Web 触发
- 加钉钉/微信要新写一个 /api/dingtalk
- 定时任务没地方跑(只能靠外部 cron + curl)
- 每加一个"消息来源"都改 /api/chat

v1 抽象:
```
UI ChatDrawer ──┐
Cron tick ──────┤
钉钉 webhook ───┼─→  Channel 适配层  →  Agent Core  →  LLM
Webhook ────────┤     (统一 IncomingMsg)
其他 ───────────┘
```

## 2. 核心类型

```typescript
// agent/src/channels/types.ts

// ─────────────────────────────────────────────────
// 统一消息格式 — 所有 Channel 都转成这个
// ─────────────────────────────────────────────────

export interface IncomingMsg {
  channelId: ChannelId          // 'web' | 'cron' | 'dingtalk' | 'webhook'
  userId: string                // 业务用户 ID, 'system' 表示非人触发
  brand: BrandCode | null       // 限定品牌 (UI 通常已知, Cron 通常 null)
  conversationId: string | null // null = 新会话
  content: string               // 用户文本 / 卡片点击回调的语义化文本
  attachments?: FileRef[]
  metadata?: Record<string, any>  // Channel 特定的扩展字段
}

export interface OutgoingMsg {
  channelId: ChannelId
  conversationId: string
  type: 'text_delta' | 'text_block' | 'thinking_delta' | 'tool_call'
       | 'tool_result' | 'task_update' | 'error' | 'done'
  payload: any
}

// ─────────────────────────────────────────────────
// Channel 抽象接口
// ─────────────────────────────────────────────────

export interface Channel {
  channelId: ChannelId
  start(): Promise<void>              // 启动监听 (开 WS server / 注册 cron / ...)
  stop(): Promise<void>               // 优雅关闭
  send(msg: OutgoingMsg): Promise<void>  // 推消息出去
}

// Channel 收到的消息会路由到同一个 sink:
// 内部其实是 ChannelManager.onIncoming(msg, ackFn)

export type ChannelId = 'web' | 'cron' | 'dingtalk' | 'webhook'
```

## 3. ChannelManager (内部路由)

```typescript
// agent/src/channels/manager.ts
// 所有 Channel 收到消息都进这里, 然后分发给 AgentRunner / TaskScheduler

import { IncomingMsg } from './types'
import { AgentRunner } from '../agent/runner'
import { TaskScheduler } from '../tasks/scheduler'

export class ChannelManager {
  constructor(
    private runner: AgentRunner,
    private scheduler: TaskScheduler,
  ) {}

  async onIncoming(msg: IncomingMsg): Promise<void> {
    // 1. 决定是即时对话 (runner) 还是长任务 (scheduler)
    if (this.isCronTrigger(msg)) {
      // Cron 触发的都走任务队列, 不阻塞 channel
      await this.scheduler.enqueue({
        taskType: msg.metadata.taskType,
        input: msg.metadata,
        triggeredBy: msg.userId,
      })
      return
    }

    // 2. 即时对话: 走 AgentRunner
    const response = await this.runner.handle(msg)

    // 3. 把响应回给原 Channel
    const channel = this.getChannel(msg.channelId)
    await channel.send({
      channelId: msg.channelId,
      conversationId: response.conversationId,
      type: 'text_block',
      payload: { text: response.text },
    })
  }

  private isCronTrigger(msg: IncomingMsg): boolean {
    return msg.channelId === 'cron'
  }
}
```

## 4. Web Channel (替代 v0 的 /api/chat)

```typescript
// agent/src/channels/web.ts

import { WebSocketServer, WebSocket } from 'ws'
import { Channel, IncomingMsg, OutgoingMsg } from './types'

export class WebChannel implements Channel {
  channelId = 'web' as const
  private wss: WebSocketServer
  private clients = new Map<string, WebSocket>()  // conversationId → ws

  constructor(
    private port: number,
    private manager: ChannelManager,
  ) {
    this.wss = new WebSocketServer({ port })
  }

  async start() {
    this.wss.on('connection', (ws, req) => {
      // 1. 鉴权 (从 query/header 拿 session token, 调 Next.js 验证)
      const userId = this.authenticate(req)
      if (!userId) { ws.close(4001, 'unauthorized'); return }

      // 2. 监听消息
      ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString())
        const msg: IncomingMsg = {
          channelId: 'web',
          userId,
          brand: data.brand ?? null,
          conversationId: data.conversationId ?? null,
          content: data.content,
          attachments: data.attachments,
          metadata: data.metadata,
        }
        await this.manager.onIncoming(msg)
      })
    })
  }

  async send(msg: OutgoingMsg) {
    // 流式: text_delta 频繁推, text_block 在句子边界推
    // 找到对应的 ws, push 出去
    const ws = this.findClient(msg.conversationId)
    if (!ws) return
    ws.send(JSON.stringify(msg))
  }

  async stop() {
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }
}
```

### v0 → v1: 协议兼容

v0 ChatDrawer 用的 SSE 协议:
```
event: text_block
data: {"text": "..."}

event: text_delta
data: {"text": "..."}

event: tool_call
data: {"name": "...", "input": {...}}

event: done
data: {}
```

v1 沿用同一组 event 类型, **包一层 WebSocket**:
```json
{ "type": "text_block", "payload": { "text": "..." } }
{ "type": "text_delta", "payload": { "text": "..." } }
{ "type": "tool_call",  "payload": { "name": "...", "input": {...} } }
{ "type": "done",       "payload": {} }
```

**ChatDrawer 前端只改一行**: `new WebSocket('ws://agent:4101/ws')` 替代 `new EventSource('/api/chat')`,消息解析逻辑不动。

## 5. Cron Channel (新增, v1 核心)

```typescript
// agent/src/channels/cron.ts

import { Channel, IncomingMsg } from './types'
import cron from 'node-cron'

interface CronEntry {
  schedule: string                  // '0 9 * * 1'
  taskType: string                  // 'weekly_bank_review'
  userId: string                    // 'system'
  metadata: Record<string, any>
}

export class CronChannel implements Channel {
  channelId = 'cron' as const
  private entries: CronEntry[] = [
    // v1 默认配置
    { schedule: '0 9 * * 1',  taskType: 'weekly_bank_review',     userId: 'system', metadata: { brand: null } },
    { schedule: '0 10 1 * *', taskType: 'monthly_financial_summary', userId: 'system', metadata: { brand: null } },
  ]
  private tasks: cron.ScheduledTask[] = []

  constructor(
    private manager: ChannelManager,
    private timezone: string = 'Asia/Shanghai',
  ) {}

  async start() {
    for (const entry of this.entries) {
      const task = cron.schedule(entry.schedule, async () => {
        const msg: IncomingMsg = {
          channelId: 'cron',
          userId: entry.userId,
          brand: entry.metadata.brand,
          conversationId: null,  // 不复用 UI 会话
          content: `运行 ${entry.taskType}`,  // 仅供审计
          metadata: { ...entry.metadata, taskType: entry.taskType },
        }
        await this.manager.onIncoming(msg)
      }, { timezone: this.timezone })
      this.tasks.push(task)
    }
  }

  async send() { /* cron 不主动推 */ }
  async stop() { this.tasks.forEach(t => t.stop()) }
}
```

**关键点**: Cron 触发**不直接**调任务,而是**走 ChannelManager → TaskScheduler**,跟用户触发走同一条路径。这样:
- 进度推送统一处理
- 审计日志统一记录
- 重试/失败处理统一

## 6. 其他 Channel (v1 留接口, 不实现)

```typescript
// agent/src/channels/dingtalk.ts  (v2)
// agent/src/channels/webhook.ts   (v2)

// 接口已经定好, 未来加只是:
const dingtalkChannel: Channel = {
  channelId: 'dingtalk',
  start() { /* 启动钉钉 stream */ },
  stop()  { /* */ },
  send(msg) { /* 调钉钉 OpenAPI */ },
}
channelManager.register(dingtalkChannel)
```

## 7. Channel 注册 (启动时)

```typescript
// agent/src/server.ts (片段)

import { WebChannel } from './channels/web'
import { CronChannel } from './channels/cron'
import { ChannelManager } from './channels/manager'
import { AgentRunner } from './agent/runner'
import { TaskScheduler } from './tasks/scheduler'

const runner = new AgentRunner(/* ... */)
const scheduler = new TaskScheduler(/* ... */)
const manager = new ChannelManager(runner, scheduler)

// 注册 v1 范围内的两个 Channel
const webChannel = new WebChannel(4101, manager)
const cronChannel = new CronChannel(manager, 'Asia/Shanghai')

await webChannel.start()
await cronChannel.start()
```

## 8. 跟 v0 的兼容性 (重要)

| 项 | v0 行为 | v1 行为 | 兼容? |
|---|---|---|---|
| UI 协议 (event 类型) | SSE 6 种 event | **WS 包同一组 event 类型** | ✓ (前端解析不动) |
| 流式颗粒 | text_block / text_delta | **同上** | ✓ |
| 工具调用展示 | tool_call 折叠块 | **同上** | ✓ |
| Thinking 展示 | thinking_delta | **同上** | ✓ |
| 输入格式 | POST body | **WS 第一帧 JSON** | ✗ (前端要改 1 行 endpoint) |

**ChatDrawer 前端只改 1 个 endpoint URL**, 其他 0 改动。

## 9. 这个组件你看什么

- **Channel 抽象是 v1 真正新设计的部分** (不像 ConfigStore 是复制)
- **统一 `IncomingMsg` / `OutgoingMsg` 格式**是关键 — 让所有消息来源看起来一样
- **Web Channel 包了 v0 的 SSE 协议** — 升级 v0 → v1 时前端 0 改动, 只换 URL
- **Cron 走 ChannelManager, 不直接调任务** — 复用进度推送 / 审计 / 重试逻辑
- **v2 的钉钉/Webhook** 只是 Channel 注册, 接口已经定好
