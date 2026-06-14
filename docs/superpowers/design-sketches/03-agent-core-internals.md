# WDG Agent Core — Internal Architecture

> B 模式的内部实现。把"短期记忆 / 长期记忆 / 任务队列 / MCP 桥"四块讲清楚。

## 总览:Agent Core 内部

```
                         ┌─────────────────────────────┐
                         │        Agent Core           │
                         │     (Node.js / Python?)     │
                         │                             │
   Channel A (Web UI) ───┤  ┌───────────────────────┐  ├───→ Anthropic API
   Channel B (Cron)   ───┤  │   Conversation Mgr   │  │
   Channel C (钉钉)   ───┤  │   (短期记忆 + 路由)   │  │
   Channel D (Webhook)──┤  └──────────┬────────────┘  │
                         │             │                │
                         │             ▼                │
                         │  ┌───────────────────────┐   │
                         │  │      Task Scheduler   │   │
                         │  │  (任务队列 + 状态机)  │   │
                         │  └──────────┬────────────┘   │
                         │             │                │
                         │             ▼                │
                         │  ┌───────────────────────┐   │
                         │  │   Agent Runner        │   │
                         │  │   (LLM + Tool Loop)   │   │
                         │  └──────┬───────────┬─────┘   │
                         │         │           │         │
                         │         ▼           ▼         │
                         │  ┌─────────┐   ┌─────────┐    │
                         │  │ Long-   │   │  MCP    │    │
                         │  │ Term    │   │  Bridge │    │
                         │  │ Memory  │   │  (45    │    │
                         │  │ (PG)    │   │  tools) │    │
                         │  └─────────┘   └─────────┘    │
                         └─────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────┐
                              │  PostgreSQL         │
                              │  agent_* schema     │
                              │  · conversations    │
                              │  · messages         │
                              │  · tasks            │
                              │  · task_steps       │
                              │  · long_term_memory │
                              │  · audit_log        │
                              └─────────────────────┘
```

## 四块基础能力 — 详细设计

### 1. 对外沟通 — Channel 抽象

每个 Channel 是一个独立的 Node.js/Python 进程或 worker,职责单一:

```typescript
// 通用 Channel 接口
interface Channel {
  channelId: string             // 'web' | 'cron' | 'dingtalk' | 'webhook'
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(msg: IncomingMsg, ack: AckFn): Promise<void>
}

// IncomingMsg 统一结构
interface IncomingMsg {
  channelId: string
  userId: string                // 业务用户 ID
  brand: BrandCode | null       // null = 跨品牌
  conversationId: string | null // null = 新会话
  content: string               // 文本 / 卡片 / 按钮回调
  attachments?: FileRef[]
  metadata?: Record<string, any>
}
```

**Web Channel (替代现有 /api/chat)**
- 复用现有 ChatDrawer 前端
- 用 WebSocket (替代 SSE, 双向) 或 SSE
- ChatDrawer → Agent Service : `/ws/agent` 或 `/sse/agent`
- 出流: stream chunks / thinking_delta / tool_call / task_update

**Cron Channel (新增)**
- 读 cron 配置 (DB 或 yaml), 每个 task 一个表达式
- 触发时构造一条 `IncomingMsg`, user_id='system', channelId='cron'
- 例: `0 9 * * 1` → 周一早上 9 点巡检

**钉钉 Channel (未来)**
- 收到钉钉机器人消息 → 转换 IncomingMsg
- Agent 回复时调钉钉 OpenAPI 发回

**关键不变性**: Channel 不知道 Agent 内部细节,只负责"消息进出 + 路由到 conversation"。

---

### 2. 记忆 — 短期 vs 长期

#### 短期记忆 (Conversation)

| 字段 | 类型 | 说明 |
|---|---|---|
| `conversation_id` | uuid | 主键 |
| `user_id` | text | |
| `brand` | text | |
| `channel_id` | text | 'web' / 'cron' / ... |
| `status` | enum | 'active' / 'archived' |
| `summary` | text | LLM 生成的摘要 (超过 20 轮后压缩) |
| `created_at` | timestamptz | |
| `last_active_at` | timestamptz | |

| 字段 | 类型 | 说明 |
|---|---|---|
| `message_id` | bigserial | |
| `conversation_id` | uuid | FK |
| `role` | enum | 'user' / 'assistant' / 'tool' / 'system' |
| `content` | text | 文本 / JSON (tool call) |
| `tool_calls` | jsonb | LLM 调用的工具 |
| `tool_results` | jsonb | |
| `thinking` | text | extended thinking 内容 |
| `created_at` | timestamptz | |

**滑动窗口策略**:
- 最近 10 轮消息全量进 prompt
- 10-30 轮之间用 summary 替换 (LLM 在前几轮结束时生成)
- 30 轮以上丢弃,只保留 summary

#### 长期记忆 (Per-user, per-brand)

| 字段 | 类型 | 说明 |
|---|---|---|
| `memory_id` | uuid | |
| `user_id` | text | |
| `brand` | text \| null | null = 跨品牌偏好 |
| `category` | enum | 'preference' / 'rule_comment' / 'context' |
| `content` | text | 事实或偏好 |
| `source_conversation_id` | uuid | 来源对话 |
| `embedding` | vector(1536) | (可选) pgvector 语义检索 |
| `created_at` | timestamptz | |

**写入时机**:
- 用户显式说"记住:X" → 立即写
- Agent 在对话中检测到"用户对某规则有偏好" → 写
- 任务完成后 (如 proposal 审批结果) → 把"为什么"写为 memory

**读取时机**:
- 每个 Agent 任务开始时, 按 (user, brand) 拉取 top-K (默认 20)
- summary 形式注入 system prompt, 不全量塞

---

### 3. 任务队列 — Long-running 任务

很多 Agent 任务不是"一问一答"的,会持续分钟级甚至小时:
- 周一早上的"上周未分类巡检": 读 N 个文件, 跑 N 个分析, 出报告
- 一次性给 50 个品牌跑 proposal 草稿
- "把上月财务数据导出 PDF" (读视图 + 渲染 + 上传)

#### 任务状态机

```
        ┌──────┐
        │ NEW  │  (新建)
        └───┬──┘
            │ enqueue
            ▼
        ┌────────┐
        │QUEUED  │  (在队列中)
        └───┬────┘
            │ worker pick
            ▼
        ┌────────┐
        │RUNNING │  (执行中)
        └───┬────┘
            │ progress events
            ▼
        ┌─────────┐
        │PAUSED?  │ (可暂停 / 恢复)
        └───┬─────┘
            │ finish
   ┌────────┼────────┬─────────┐
   ▼        ▼        ▼         ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌────────┐
│ DONE │ │FAILED│ │CANCEL│ │PARTIAL │ (部分完成, 需人介入)
└──────┘ └──────┘ └──────┘ └────────┘
```

#### 表结构

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | uuid | |
| `parent_task_id` | uuid \| null | 父任务 (子任务链) |
| `conversation_id` | uuid \| null | 关联的对话 |
| `user_id` | text | 发起人 |
| `task_type` | text | 'weekly_review' / 'bulk_propose' / 'export_pdf' |
| `input` | jsonb | |
| `status` | enum | 见上 |
| `progress` | int 0-100 | |
| `result` | jsonb | |
| `error` | jsonb | |
| `created_at` | timestamptz | |
| `started_at` | timestamptz \| null | |
| `finished_at` | timestamptz \| null | |

| 字段 | 类型 | 说明 |
|---|---|---|
| `step_id` | bigserial | |
| `task_id` | uuid | FK |
| `step_index` | int | |
| `description` | text | "分析文件 X" / "生成报告草稿" |
| `status` | enum | |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz \| null | |
| `result` | jsonb | |
| `error` | jsonb | |

#### 任务调度

- **DB-backed queue** (PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`):
  - 不引入 Redis / Celery, 沿用现有 PG
  - 启动 N 个 worker (默认 2-4), 轮询 `tasks WHERE status='QUEUED'`
- **进度推送**:
  - 每个 step 完成 → 写 task_step + 通知 channel
  - Web Channel: 通过 SSE / WS 推送给前端
  - 钉钉 Channel: 发卡片状态更新
- **取消**: 改 status='CANCELLED', worker 检测后退出当前 step

#### 任务类型注册表

```typescript
// 在 Agent Service 启动时注册
taskRegistry.register('weekly_review', {
  steps: [
    'list_unclassified_files',
    'per_file: get_unclassified_count',
    'aggregate: top_opportunities',
    'draft: report'
  ],
  // 每个 step 调什么 MCP tool 由这一步决定
})
```

---

### 4. MCP 桥 — 复用现有 45 个 tools

Agent Service 不重新实现一遍数据库读写,**全部调既有的 `/api/mcp`**:

```typescript
// Agent Service 内部
class McpBridge {
  private endpoint = process.env.MCP_ENDPOINT || 'http://localhost:4100/api/mcp'

  async call(toolName: string, args: any, userId: string): Promise<any> {
    // 1. 注入 session header
    // 2. 调 JSON-RPC
    // 3. 返回结果
  }

  // LLM tool schema 来源
  listTools(): ToolSchema[] { /* 调 tools/list */ }
}
```

**关键**: 既有 MCP server 的"Agent 写权限原则"不变 —— Agent 只能调 proposal / rerun / upload,不能调 create_rule / settle。审批环节永远在 UI 里。

---

## 数据流示例: 老板问"上周瑞安店利润"

```
1. Web Channel 收到 chat 消息
   ↓
2. Conversation Mgr: 查 / 新建 conversation, 注入短期记忆
   ↓
3. 读 Long-term Memory: (user=ceo, brand=bonjur) → 偏好
   ↓
4. 拼 system prompt: 角色 + 工具 + 记忆 + 短期消息
   ↓
5. Agent Runner: LLM 决定 → 调 query_financial_statement
   ↓
6. McpBridge: → POST /api/mcp → 既有 API 读 v_profit_statement
   ↓
7. 结果回 LLM → LLM 生成自然语言 + 调用 query_counterparty 解释
   ↓
8. SSE 流回 Web Channel → ChatDrawer 渲染
   ↓
9. 任务完成: 写长期记忆 (用户问过此类问题)
   ↓
10. Audit log: user / action / tools / tokens
```

---

## 部署形态

```
Docker Compose (现有) + 一个新 service:
  agent:
    build: ./agent
    environment:
      - MCP_ENDPOINT=http://ui:3000/api/mcp
      - ANTHROPIC_API_KEY=...
      - DATABASE_URL=postgresql://...
    depends_on: [db, ui]
    ports: [4101:4101]   # WebSocket / SSE 端点
```

UI 改一处: ChatDrawer 的 fetch URL 从 `/api/chat` 改为 `http://agent:4101/ws`。
(或者通过 Next.js proxy, 避免 CORS, 看部署偏好)

---

## 改造量评估

| 块 | 改造量 | 备注 |
|---|---|---|
| Channel 抽象 + Web Channel 替换 | 1 周 | 现有 ChatDrawer 微调, 加 WebSocket |
| Conversation / Message 持久化 | 0.5 周 | DDL + API |
| 长期记忆 (基础版) | 0.5 周 | 写入 / 读取, 不含 embedding |
| 任务队列 (基础版) | 1-1.5 周 | DB queue + 状态机 + 2 个 task type |
| Cron Channel | 0.5 周 | 周一巡检 + 每月财务推送 |
| MCP 桥 | 0.5 周 | 调 /api/mcp |
| 部署 / docker-compose | 0.5 周 | |
| 测试 + 文档 | 1 周 | |
| **合计** | **5-6 周** | 1 个工程师 |
