# WDG Agent-First — 完整架构图 (含 v1 切分方案)

## 完整图 (B 模式 + Node.js + Skills Y 方案)

```
┌──────────────────── 客户端层 ────────────────────────┐
│                                                     │
│   Next.js UI (port 4100)    钉钉 (未来)   Webhook   │
│        │                       │             │      │
│        │ ChatDrawer            │             │      │
│        │ (现有, 改 endpoint)   │             │      │
│        └───────────┬───────────┴─────────────┘      │
└────────────────────┼────────────────────────────────┘
                     │  WS / SSE / HTTP
                     ▼
┌──────────────────── Agent Service (Node.js, port 4101) ──────────────┐
│                                                                     │
│  ┌─────────────────── Channel 抽象层 ───────────────────┐           │
│  │  WebChannel   CronChannel   DingtalkChannel  ...    │           │
│  └────────────────────┬─────────────────────────────────┘           │
│                       │                                            │
│                       ▼                                            │
│  ┌────────────── Conversation Manager ────────────────┐            │
│  │  · 短期记忆 (DB: conversations + messages)         │            │
│  │  · 滑动窗口: 最近 10 轮全量 + 之前 summary         │            │
│  │  · per-conversation state                          │            │
│  └────────────────────┬───────────────────────────────┘            │
│                       │                                            │
│                       ▼                                            │
│  ┌────────────── Skill Index (Y 方案) ────────────────┐            │
│  │  启动时扫描 agent/skills/*.md, parse frontmatter   │            │
│  │  注入 system prompt: name + description 列表       │            │
│  │  LLM 主动调 load_skill(name) → 展开全文            │            │
│  └────────────────────┬───────────────────────────────┘            │
│                       │                                            │
│                       ▼                                            │
│  ┌────────────── Agent Runner (LLM Loop) ────────────┐            │
│  │  · Anthropic SDK (Opus 4 / Sonnet 4)               │            │
│  │  · 工具循环: tool_use → 执行 → 结果回灌            │            │
│  │  · 流式输出: text_delta / thinking_delta           │            │
│  │  · Token 监控 + soft / hard limit                  │            │
│  └──────┬──────────────────────┬──────────────────────┘            │
│         │                      │                                   │
│         ▼                      ▼                                   │
│  ┌──────────────┐      ┌──────────────────┐                       │
│  │ MCP Bridge   │      │  Task Scheduler  │                       │
│  │ 调 /api/mcp  │      │ (DB-backed queue) │                       │
│  │ 45 tools     │      │ status: NEW→...  │                       │
│  └──────┬───────┘      │      →DONE/FAILED│                       │
│         │              └────────┬─────────┘                       │
│         │                       │                                  │
└─────────┼───────────────────────┼──────────────────────────────────┘
          │                       │
          ▼                       ▼
   ┌──────────────────────────────────────┐
   │     PostgreSQL (Supabase)            │
   │                                      │
   │  既有:                               │
   │   · brand_*_ods/_cfg/_dm             │
   │   · ops.*                            │
   │                                      │
   │  新增 (agent schema):                │
   │   · agent.conversations              │
   │   · agent.messages                   │
   │   · agent.tasks                      │
   │   · agent.task_steps                 │
   │   · agent.audit_log                  │
   └──────────────────────────────────────┘
          │
          │ (通过既有 /api/mcp)
          ▼
   ┌──────────────────────────────────────┐
   │     既有 Next.js API (port 4100)     │
   │     /api/financial /api/match ...    │
   │     /api/mcp (45 tools)              │
   └──────────────────────────────────────┘
```

## 部署形态

```
docker-compose.yml:
  db      (PostgreSQL 16)        — 既有
  ui      (Next.js, port 4100)   — 既有, ChatDrawer 改 endpoint
  agent   (Node.js, port 4101)   — 新增, Fastify + ws
  metabase                       — 既有
```

---

## v1 切多大? 三个方案

### 方案 1 — "薄薄一层" (1.5-2 周)

**做什么:**
- Agent Service 跑起来 (Fastify + ws)
- Web Channel 接 ChatDrawer (替代现有 /api/chat)
- Conversation / Messages 持久化 (短期记忆)
- Skill Index (Y 方案, 加载机制)
- MCP Bridge 接既有 45 个 tools
- **2 个示范 skill**:
  - `weekly-bank-review` — 拉 KPI + 未分类 + 提 proposal 草稿
  - `qimai-revenue-anomaly` — 对比本月 vs 上月收入

**不做什么:**
- 任务队列 (用 inline await 跑,长任务先不支持)
- Cron Channel (定时任务先不做)
- 钉钉 / Webhook (留空)

**价值:** 把现有 ChatDrawer 接到新底座,2 个 skill 立刻能跑,作为概念验证。

**风险:** 跟现状差别小,看不出"Agent 为主的产品"的差异。

---

### 方案 2 — "Agent 底座 + 主动能力" (4-5 周)  ← **推荐**

**在 1 的基础上加:**
- 任务队列 (DB-backed, 状态机, Web UI 进度推送)
- Cron Channel (周一早上自动跑 `weekly-bank-review`, 推送给 admin)
- 通知系统 (推"任务完成 / 异常 / 待审" 给用户, Web + 未来可加钉钉)
- **再加 2-3 个 skill** (共 4-5 个):
  - `monthly-financial-summary` (用任务队列跑长任务)
  - `bulk-propose-rules` (批量提规则草稿)
  - `cashflow-anomaly` (现金流异常诊断)

**价值:** **首次让 Agent 主动做事** —— 周一早上用户打开 UI 就看到"上周巡检报告",这才是"产品"而不是"工具"。

**风险:** 多 2-3 周,任务队列和 Cron 都需要测试。

---

### 方案 3 — "全栈 + 自治白名单" (7-8 周)

**在 2 的基础上加:**
- 钉钉 Channel (1 周)
- 写入白名单 (低风险动作自动执行,如刷新 snapshot) (1 周)
- 长期记忆 (你之前去掉了,这里如果改主意就加) (1 周)
- 更多 skill (8-10 个) (1-2 周)
- E2E 测试 + 文档 (1 周)

**价值:** 完整"agent 为主的产品"形态,具备老板视角(A 用户)的能力。

**风险:** 时间长,可能陷入"过早优化"。

---

## 我的强烈推荐: 方案 2

理由:
- 1 太薄,做完你看不到"Agent 主动"的核心价值
- 3 太重,7-8 周后,可能发现方向要调整
- 2 在 4-5 周内有"主动能力" + "任务队列"两个**新底座** + 5 个 skill, **有产品感但不至于失控**
- 后续做 3 时,2 的所有模块都已经稳定,可以增量加

**你的选择?** 1 / 2 / 3 / 或者你心里有别的切法?
