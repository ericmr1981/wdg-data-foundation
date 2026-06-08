# WDG Agent-First — 方案 2 完整项目结构

> 选定的方案: Agent 底座 + 主动能力 (4-5 周)
> 包括: Agent Service (Node.js) + Channel 抽象 + WebSocket/Web Channel + Cron + 任务队列 + Skill Index (Y 方案) + 5 个 skill + 通知推送

## 顶层目录变化

```
wdg-data-foundation/
├── agent/                          # ★ 新增 - Agent Service (Node.js)
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.ts               # Fastify 入口
│   │   ├── config.ts               # 环境变量, MCP 端点, 端口
│   │   ├── channels/               # Channel 抽象
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── web.ts              # WebSocket Channel (替代 /api/chat)
│   │   │   └── cron.ts             # Cron Channel (周一 9 点)
│   │   ├── conversation/           # 短期记忆
│   │   │   ├── manager.ts          # ConversationMgr
│   │   │   ├── repository.ts       # PG queries
│   │   │   └── window.ts           # 滑动窗口 + summary
│   │   ├── skills/                 # Skill 加载 (Y 方案)
│   │   │   ├── loader.ts           # 扫描目录, parse frontmatter
│   │   │   ├── registry.ts         # 内存中的 skill index
│   │   │   └── load-skill-tool.ts  # MCP-style tool for LLM
│   │   ├── mcp/                    # MCP 桥
│   │   │   ├── bridge.ts           # 调 /api/mcp 的客户端
│   │   │   └── tool-schema.ts      # 工具 schema 转换
│   │   ├── agent/                  # Agent Runner
│   │   │   ├── runner.ts           # LLM 循环 (Anthropic SDK)
│   │   │   ├── stream.ts           # 流式输出
│   │   │   ├── prompt.ts           # system prompt 拼装
│   │   │   └── token-monitor.ts    # soft/hard limit
│   │   ├── tasks/                  # 任务队列
│   │   │   ├── queue.ts            # DB-backed queue
│   │   │   ├── worker.ts           # worker 循环
│   │   │   ├── types.ts            # Task/Step 类型
│   │   │   └── tasks/              # 具体任务类型
│   │   │       ├── weekly-bank-review.ts
│   │   │       └── monthly-financial-summary.ts
│   │   ├── notifications/          # 通知推送
│   │   │   ├── notifier.ts         # 推送接口
│   │   │   └── web-push.ts         # Web 通道 (走 WebChannel)
│   │   ├── audit/                  # 审计
│   │   │   └── logger.ts
│   │   └── db.ts                   # pg.Pool
│   └── skills/                     # ★ Skill 文件 (Markdown)
│       ├── weekly-bank-review.md
│       ├── qimai-revenue-anomaly.md
│       ├── monthly-financial-summary.md
│       ├── bulk-propose-rules.md
│       └── cashflow-anomaly.md
│
├── sql/                            # 既有, + 1 个新文件
│   ├── 00_infrastructure/
│   ├── ...
│   └── 00_agent_schema.sql         # ★ 新增 - agent.* DDL
│
├── ui/                             # 既有, ChatDrawer 改 endpoint
│   ├── src/
│   │   ├── components/chat/
│   │   │   ├── ChatDrawer.tsx      # 改 fetch URL → ws://agent:4101
│   │   │   └── ChatWidget.tsx
│   │   └── app/
│   │       ├── api/chat/route.ts   # 删掉或保留为降级 fallback
│   │       └── u/notifications/    # ★ 新增 - 通知中心页
│   │           └── page.tsx
│
├── docker-compose.yml              # 既有, + agent service
├── docs/
│   ├── superpowers/
│   │   ├── design-sketches/        # ★ 本次 brainstorm 输出
│   │   └── specs/
│   │       └── 2026-06-08-agent-first-product.md  # ★ 最终 spec
│   └── ...
```

## 关键模块关系

```
                       ┌─────────────────────────┐
                       │   Fastify (port 4101)   │
                       └────────────┬────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
   ┌────────────────┐    ┌────────────────────┐    ┌────────────────┐
   │  WebChannel    │    │   CronChannel      │    │  Notifier      │
   │  (ws /api/ws)  │    │  (周一 9 点)       │    │  (推 Web UI)   │
   └───────┬────────┘    └─────────┬──────────┘    └────────┬───────┘
           │                       │                        │
           │ ws msg                │ 构造 IncomingMsg       │
           │                       │                        │
           └───────────┬───────────┴────────────────────────┘
                       ▼
            ┌──────────────────────┐
            │ Conversation Manager │ ← 短期记忆
            │  (PG: conversations, │
            │       messages)      │
            └──────────┬───────────┘
                       │ 拼 system prompt
                       ▼
            ┌──────────────────────┐
            │  Skill Registry      │ ← Y 方案
            │  (内存, 启动时加载)  │    description 常驻
            └──────────┬───────────┘
                       │ LLM 调 load_skill()
                       ▼
            ┌──────────────────────┐
            │   Agent Runner       │ ← Anthropic SDK
            │   (LLM 循环)         │
            └──────┬───────────────┘
                   │ tool_use
        ┌──────────┼──────────────┐
        ▼          ▼              ▼
   ┌────────┐ ┌─────────┐  ┌──────────────┐
   │ MCP    │ │ Task    │  │  load_skill  │
   │ Bridge │ │ Worker  │  │  (内部 tool) │
   └───┬────┘ └────┬────┘  └──────────────┘
       │           │
       │ HTTP      │ 写 task_step
       ▼           ▼
   ┌──────────────────────┐
   │  PostgreSQL          │
   │  · agent.* (新)      │
   │  · 既有 schemas      │
   └──────────────────────┘
       │
       │ (通过 MCP Bridge 调既有)
       ▼
   ┌──────────────────────┐
   │  Next.js /api/mcp    │ 既有 45 tools
   └──────────────────────┘
```

## 新增 DDL 概览 (`sql/00_agent_schema.sql`)

```sql
CREATE SCHEMA IF NOT EXISTS agent;

-- 短期记忆: conversations
CREATE TABLE agent.conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  brand             TEXT,
  channel_id        TEXT NOT NULL,        -- 'web' | 'cron' | ...
  status            TEXT NOT NULL DEFAULT 'active',
  summary           TEXT,                  -- LLM 压缩
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 短期记忆: messages
CREATE TABLE agent.messages (
  message_id        BIGSERIAL PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES agent.conversations(conversation_id),
  role              TEXT NOT NULL,         -- 'user' | 'assistant' | 'tool' | 'system'
  content           TEXT NOT NULL,
  tool_calls        JSONB,
  tool_results      JSONB,
  thinking          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conv ON agent.messages(conversation_id, message_id);

-- 任务队列
CREATE TABLE agent.tasks (
  task_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id    UUID,
  conversation_id   UUID,
  user_id           TEXT,
  task_type         TEXT NOT NULL,         -- 'weekly_bank_review' | ...
  input             JSONB,
  status            TEXT NOT NULL DEFAULT 'QUEUED',
                   -- 'NEW' | 'QUEUED' | 'RUNNING' | 'PAUSED' |
                   -- 'DONE' | 'FAILED' | 'CANCELLED' | 'PARTIAL'
  progress          INT DEFAULT 0,
  result            JSONB,
  error             JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);

CREATE INDEX idx_tasks_status ON agent.tasks(status, created_at);

CREATE TABLE agent.task_steps (
  step_id           BIGSERIAL PRIMARY KEY,
  task_id           UUID NOT NULL REFERENCES agent.tasks(task_id),
  step_index        INT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING',
                   -- 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  result            JSONB,
  error             JSONB,
  UNIQUE(task_id, step_index)
);

-- 审计
CREATE TABLE agent.audit_log (
  log_id            BIGSERIAL PRIMARY KEY,
  user_id           TEXT,
  conversation_id   UUID,
  task_id           UUID,
  action            TEXT NOT NULL,         -- 'tool_call' | 'message' | 'task' | ...
  payload           JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON agent.audit_log(user_id, created_at DESC);
```

## Skill 文件示例 (`agent/skills/weekly-bank-review.md`)

```markdown
---
name: weekly-bank-review
description: |
  周一早上 / 用户问"上周怎么样"时加载。
  拉上周未分类,按对手聚合,生成可审批的 proposal 草稿。
triggers:
  - "上周"
  - "周报"
  - "周复盘"
  - "上周怎么样"
---

# 周银行流水复盘

## 适用场景
- ...

## 工作流
1. get_pipeline_kpi (brand=$current)
2. get_unclassified_by_file (limit=10)
3. ...

## 注意事项
- ...
```

## Docker Compose 新增

```yaml
services:
  agent:
    build: ./agent
    container_name: wdg-agent
    environment:
      - MCP_ENDPOINT=http://ui:3000/api/mcp
      - DATABASE_URL=postgresql://...
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - WS_PORT=4101
      - CRON_TIMEZONE=Asia/Shanghai
    depends_on: [db, ui]
    ports: ["4101:4101"]
    restart: unless-stopped
```

## 5 个 Skill (v1 内交付)

| Skill | 触发场景 | 调用的 MCP tools |
|---|---|---|
| `weekly-bank-review` | 周一早 / "上周怎么样" | `get_pipeline_kpi`, `get_unclassified_by_file`, `get_unclassified_transactions`, `get_candidates`, `submit_proposal` |
| `qimai-revenue-anomaly` | "为什么收入下降" | `query_qimai_revenue`, `query_income_metrics`, `query_financial_kpi_trend` |
| `monthly-financial-summary` | "上月财务总结" (用任务队列) | `query_financial_statement`, `query_counterparty`, `query_payment_metrics` |
| `bulk-propose-rules` | "批量提规则" | `get_unclassified_transactions`, `get_candidates`, `get_rules`, `submit_proposal` |
| `cashflow-anomaly` | "现金流异常" | `query_cashflow` (或 financial statement), `query_counterparty` |

## 5 周排期

| 周 | 内容 |
|---|---|
| W1 | DDL (agent schema) + Fastify 启动 + Web Channel (ws) + Conversation 持久化 |
| W2 | Skill Loader + load_skill tool + 1-2 个 skill 跑通 + ChatDrawer 改 endpoint |
| W3 | MCP Bridge + 补全 5 个 skill + 流式输出 + Token 监控 |
| W4 | Task Scheduler (DB queue) + Worker + 通知推送 + Cron Channel |
| W5 | E2E 测试 (Playwright + 手测) + 文档 + 部署 |

## 不在 v1 范围

明确**不做**(避免 scope creep):
- ❌ 钉钉 Channel (留 v2)
- ❌ 长期记忆 (你之前去掉了)
- ❌ 写入白名单 / 自治动作
- ❌ 知识图谱 / 嵌入向量
- ❌ 多 Agent 协作
- ❌ A 用户(老板)的自然语言分析能力 — **数据基础要先稳**,老板模式是 v2

## 验收标准 (v1)

- [ ] 打开 `/u/...`, ChatDrawer 仍可用,所有现有对话体验不变
- [ ] ChatDrawer 问"上周怎么样" → 自动加载 `weekly-bank-review` → 调 MCP 拉数据 → 出报告
- [ ] 周一早上 9 点, admin 收到自动推送"上周巡检完成" → 点开看到任务报告
- [ ] 5 个 skill 全部可触发, 每个跑通至少 1 次真实数据
- [ ] 任务队列: 提交一个 5 步的 `monthly-financial-summary` 任务, 进度能在 UI 看到
- [ ] `pytest tests/ -v` 仍然 pass
- [ ] `cd ui && npx next build` 仍然 succeed
- [ ] `docker compose up -d` 起 4 个服务 (db / ui / agent / metabase)
