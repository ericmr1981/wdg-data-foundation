# WDG Agent-First — 整体项目架构图 (方案 2)

> 鸟瞰整个项目,展示所有组件、它们的关系、数据流向、用户触点。

## 1. 整体鸟瞰 (5 层架构)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ① 用户/外部触点                                    │
│                                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│  │ 浏览器用户  │   │  钉钉用户   │   │  Webhook    │   │   定时任务      │  │
│  │ (B/A 用户)  │   │  (v2)       │   │  (v2)       │   │   (Cron)        │  │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └────────┬────────┘  │
└─────────┼─────────────────┼─────────────────┼────────────────────┼──────────┘
          │                 │                 │                    │
          │ HTTPS           │ 钉钉 OpenAPI    │ HTTP POST          │ (内部触发)
          ▼                 ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ② 客户端 / Channel 层                                    │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  Next.js UI (port 4100)   ← 既有, 客户端形态                      │     │
│  │  ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌─────────────┐  │     │
│  │  │/u/income │ │/u/...  │ │/u/rules│ │/u/notif │ │ ChatDrawer  │  │     │
│  │  │/u/payment│ │financ. │ │/u/appr.│ │ications │ │ (WebSocket) │  │     │
│  │  └──────────┘ └────────┘ └────────┘ └─────────┘ └──────┬──────┘  │     │
│  └────────────────────────────────────────────────────────┼─────────┘     │
│                                                            │              │
└────────────────────────────────────────────────────────────┼──────────────┘
                                                             │
          ┌──────────────────────────────────────────────────┘
          │ ws://agent:4101/ws       (WebSocket, 流式)
          │ http://agent:4101/api/*  (REST, 任务提交/查询)
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ③ Agent Service (Node.js, port 4101)  ★ 新增             │
│                                                                             │
│  ┌──────────── Channel 适配层 ─────────────┐                                │
│  │  WebChannel   CronChannel   *Channel    │  ← 消息进出, 无业务           │
│  └─────────────────────┬───────────────────┘                                │
│                        ▼                                                    │
│  ┌─────────── Conversation Manager ───────────┐                             │
│  │  短期记忆: PG conversations/messages       │                             │
│  │  滑动窗口: 最近 10 轮全量 + 更早 summary   │                             │
│  └─────────────────────┬─────────────────────┘                             │
│                        ▼                                                    │
│  ┌─────────── Skill Index (Y 方案) ──────────┐                              │
│  │  启动时扫描 agent/skills/*.md              │  description 常驻          │
│  │  LLM 调 load_skill(name) → 展开全文         │  → 临时注入 context         │
│  └─────────────────────┬─────────────────────┘                             │
│                        ▼                                                    │
│  ┌─────────── Agent Runner (LLM Loop) ───────┐                              │
│  │  Anthropic SDK  ·  工具循环                  │                              │
│  │  流式输出  ·  Token 监控                    │                              │
│  └──────┬──────────────────┬──────────────────┘                             │
│         │                  │                                                │
│         ▼                  ▼                                                │
│  ┌──────────────┐  ┌──────────────────┐                                     │
│  │  MCP Bridge  │  │  Task Scheduler  │                                     │
│  │  (HTTP)      │  │  (DB-backed)     │                                     │
│  └──────┬───────┘  └────────┬─────────┘                                     │
│         │                   │                                                │
│         │  HTTP             │ 查/写 tasks, task_steps                       │
└─────────┼───────────────────┼────────────────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              ④ 既有 Next.js API 层 (port 4100)                             │
│                                                                             │
│  ┌─ REST API (既有, 业务接口) ─────────────────────────────────────┐        │
│  │  /api/financial/*      /api/match/*       /api/rules/*          │        │
│  │  /api/coverage/*       /api/upload/*      /api/admin/*         │        │
│  │  /api/approval/*       /api/auth/*        /api/store-report/*  │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                                                             │
│  ┌─ JSON-RPC MCP (既有, Agent 专用入口) ─────────────────────────┐         │
│  │  /api/mcp   ←  45 tools, 9 模块                                 │         │
│  │  · 银行流水 11  · 审批 3  · 财务 7  · 销售 11                   │         │
│  │  · 收入 4  · 库存 1  · 元数据 4  · 审计 1  · 门店月报 2         │         │
│  └──────────────────────────────────────────────────────────────┘        │
│                                                                             │
│  ┌─ 即将退役 (降级为 fallback) ────────────────────────────────┐          │
│  │  /api/chat  ←  现有 ChatDrawer 走后端, v1 后改用 ws://agent  │          │
│  └──────────────────────────────────────────────────────────────┘          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   │ SQL (pg)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  ⑤ 数据层 (PostgreSQL 16, Supabase)                         │
│                                                                             │
│  ┌── 业务数据 (既有) ──────────────────────────────────────────────┐       │
│  │  raw.*                   原始文件跟踪                              │       │
│  │  brand_*_ods.{bank_txn,  ODS 层 (银行流水, 销售, 库存)            │       │
│  │     sales_monthly, ...}                                            │       │
│  │  brand_*_cfg.{bank_rule_map,  CFG 层 (规则, 分类字典)              │       │
│  │     category_dictionary}                                           │       │
│  │  brand_*_dm.{v_profit, v_cashflow, DM 层 (财务视图, KPI)           │       │
│  │     v_balance_sheet, ...}                                          │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  ┌── 运营数据 (既有) ──────────────────────────────────────────────┐       │
│  │  ops.{brands, stores, allowed_schemas,  跨品牌元数据 + 审计        │       │
│  │     pipeline_run, pipeline_step_run,                              │       │
│  │     login_attempts, ...}                                          │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  ┌── Agent 数据 (★ 新增) ────────────────────────────────────────┐       │
│  │  agent.conversations        短期记忆: 会话                        │       │
│  │  agent.messages             短期记忆: 消息                       │       │
│  │  agent.tasks                任务队列: 任务                       │       │
│  │  agent.task_steps           任务队列: 步骤                       │       │
│  │  agent.audit_log            审计: 所有 tool_call / 消息          │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│              ⑥ 离线层 (Python, 本地 / CI)                                    │
│                                                                             │
│  scripts/                                                                    │
│  ├── run_pipeline_oneclick.py   管道编排: import → classify → refresh       │
│  ├── import_*.py                各品牌/各源文件导入                         │
│  ├── classify.py                规则引擎 (与 SQL fn_classify 一致)          │
│  ├── create_views.py            物化视图刷新                                │
│  └── run_drift_check.sh         schema 漂移检测                             │
│                                                                             │
│  触发方式:                                                                    │
│  · 手动: python3 scripts/run_pipeline_oneclick.py --brand all                │
│  · Agent 不能直接触发 ETL (写权限原则: 只调 MCP, 不调 Python)               │
│  · 未来 v2: Agent 可触发 refresh_classified_snapshot (在 MCP 写权限白名单内) │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│              ⑦ BI / 外部 (既有)                                              │
│                                                                             │
│  Metabase (port 3030)   报表 / 仪表盘 / Dashboard                            │
│  · 数据源: 既有 PG schemas                                                    │
│  · Agent 不直接接入 Metabase                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 数据流示例 — 三个真实场景

### 场景 A: 用户在 ChatDrawer 问"上周怎么样"

```
[1] 浏览器 (B用户) 
    │  在 ChatDrawer 输入"上周怎么样"
    │  → WebSocket send → ws://agent:4101/ws
    ▼
[2] Agent Service — WebChannel
    │  构造 IncomingMsg{user_id, brand, channelId:'web', content: '上周怎么样'}
    ▼
[3] Conversation Manager
    │  查/新建 conversation, 拉最近 10 轮 messages + summary
    │  拼 system prompt (角色 + 工具 + 业务上下文 + 短期记忆)
    ▼
[4] Skill Index (Y 方案)
    │  system prompt 里有 5 个 skill 的 description
    │  LLM 看到 '上周怎么样' 匹配 weekly-bank-review 的 trigger
    │  → 调 load_skill('weekly-bank-review')
    ▼
[5] Skill Registry
    │  返回 SKILL.md 全文 (~1K tokens)
    │  临时插入到当前对话的 system message 里
    ▼
[6] Agent Runner (LLM Loop)
    │  LLM 决定 → 调 get_pipeline_kpi(brand=yufeng)
    ▼
[7] MCP Bridge
    │  HTTP POST /api/mcp {method: 'tools/call', params: {name:'get_pipeline_kpi', args:...}}
    ▼
[8] Next.js /api/mcp
    │  路由到 get-pipeline-kpi.ts wrapper
    │  → SQL: SELECT * FROM yufeng_dm.v_coverage_monthly
    ▼
[9] PostgreSQL
    │  返回: {classified: 1247, unclassified: 89, total: 1336}
    │  ↑ ↑ ↑
    │  8 ← 7 ← 6 (LLM 继续推理, 调更多 tools)
    ▼
[10] 流式输出
     LLM 生成的 text → text_delta SSE → WebChannel → ChatDrawer 渲染
     tool_call → 折叠块显示
     最终: "上周有 89 笔未分类,主要来自供应商 X..."
     ↓
[11] 持久化
     · agent.messages 写 user + assistant + tool_use 消息
     · agent.audit_log 记这次调用的所有信息
     · 任务完成, 不进 agent.tasks (这是即时对话, 非长任务)
```

### 场景 B: 周一早 9 点 Cron 自动巡检

```
[1] CronChannel
    │  触发: 0 9 * * 1 (周一 9:00)
    │  构造 IncomingMsg{user_id:'system', channelId:'cron', content: '运行 weekly-bank-review'}
    │  → 调 TaskScheduler.enqueue(taskType='weekly_bank_review', ...)
    ▼
[2] Task Scheduler (DB queue)
    │  INSERT INTO agent.tasks (status='QUEUED', task_type='weekly_bank_review')
    │  启动 worker 轮询 → 抢到任务, status='RUNNING'
    ▼
[3] Worker
    │  按 task type 找到 handler
    │  加载对应 skill (跟场景 A 同样的方式)
    │  跑 5 个 step:
    │    step 1: get_pipeline_kpi
    │    step 2: get_unclassified_by_file
    │    step 3: get_unclassified_transactions (per file)
    │    step 4: 聚合 + LLM 总结
    │    step 5: 生成 markdown 报告
    │  每步写 agent.task_steps
    ▼
[4] 完成后
    │  · status='DONE', result={summary, top_opportunities: [...]}
    │  · Notifier 推送: 'weekly_bank_review 完成, 发现 12 个改进点'
    │  · 推送给所有 admin 用户
    ▼
[5] B 用户周一早上打开 UI
    │  在 /u/notifications 看到红点
    │  点开 → 看到 weekly_bank_review 报告
    │  可以一键跳到 /u/approvals 审批 Agent 提的 proposal
```

### 场景 C: 用户调起"导出上月财务 PDF" (任务队列 + 长任务)

```
[1] ChatDrawer: "把上月财务数据导成 PDF"
    ▼
[2] Agent Runner 看到任务超过单次对话能力
    │  → submit_task(taskType='export_monthly_pdf', input={period: '2026-05'})
    ▼
[3] Task Scheduler
    │  入队 → worker 接手 → 跑多个 step
    │  · step 1: query_financial_statement (3 表)
    │  · step 2: query_counterparty
    │  · step 3: 生成 markdown
    │  · step 4: 调 wkhtmltopdf / puppeteer 渲染
    │  · step 5: 上传到 Supabase Storage
    │  每步 push progress (10% → 30% → 60% → 90% → 100%)
    ▼
[4] Web UI
    │  ChatDrawer 看到 task 进度更新 (实时)
    │  完成后: 弹通知 "PDF 已生成, 点击下载"
```

## 3. 信任边界 (谁可以做什么)

```
┌──────────────────────────────────────────────────────────────────┐
│  任何用户 (B/A)        审批员 (admin)    Agent           离线 ETL  │
├──────────────────────────────────────────────────────────────────┤
│  ✓ 提问/查报表         ✓ 同左           ✓ 调 MCP (读)    ✓ 写 ODS │
│  ✓ 触发任务            ✓ 审批 proposal  ✓ submit_proposal       │
│  ✓ 接收通知            ✓ 改 cfg/rules   ✓ upload_*              │
│                        ✓ 创建/修改规则  ✓ rerun_match           │
│  ✗ 写 cfg              ✗ 改 schema      ✗ 改 cfg/rules          │
│  ✗ 直接写 DB           ✗ 直接写 DB     ✗ 直接写 DB             │
└──────────────────────────────────────────────────────────────────┘
        决策权始终在人, Agent 是放大器, 不是替代者
```

## 4. 部署拓扑

```
┌───── 服务器 (1 台或 k8s 集群) ──────────────────────────────┐
│                                                              │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│   │   ui     │  │  agent   │  │ metabase │  │   db     │    │
│   │ :4100    │  │  :4101   │  │  :3030   │  │  :5432   │    │
│   │ Next.js  │  │ Node.js  │  │  (JVM)   │  │ Postgres │    │
│   └─────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│         │            │            │             │           │
│         └────────────┴────────────┴─────────────┘           │
│                         (内部网络)                            │
└──────────────────────────────────────────────────────────────┘
   端口暴露:
   · 4100: 用户访问 (Next.js)
   · 3030: BI 用户 (Metabase)
   · 4101: 仅 agent ↔ ui 内部 (无需暴露公网)
   · 5432: 不暴露
```

## 5. 演进路径 (v1 → v2 → v3)

| 版本 | 主题 | 关键变化 |
|---|---|---|
| **v1** (本方案, 4-5 周) | Agent 底座 + 主动能力 | Agent Service 上线, 5 个 skill, Cron 巡检, 任务队列 |
| **v2** | 多渠道 + 写入白名单 | 钉钉 Channel, 自动 refresh snapshot, 写权限分级 |
| **v3** | 老板视角 (A 用户) | 自然语言问经营, 派单, 知识图谱 (可选) |

## 6. 这个图你看到了什么

- ①② 是用户层: **没新增用户触点**, 现有 UI 还是主入口, ChatDrawer 复用
- ③ 是新增的: **唯一一个全新进程**, 但内部组件化清晰
- ④ 是既有 API: **完全复用**, 45 个 MCP tools 不变
- ⑤ 是数据层: **加一个 agent schema**, 业务表零修改
- ⑥⑦ 是离线/BI: **完全不动**

**改动范围 = 一个新进程 + 一个新 schema + 一处 UI endpoint 修改**。其他 95% 复用。
