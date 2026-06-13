# WDG Agent-First Product — Design Spec

**Date**: 2026-06-08
**Status**: Draft (待 review)
**Author**: Claude Code (brainstorm with ericmr)
**Branch**: `worktree-agent-first-product`
**Worktree**: `/Users/ericmr/Documents/GitHub/wdg-data-foundation/.claude/worktrees/agent-first-product`

---

## 1. 概述 (Overview)

把 WDG Data Foundation 演化成"**以 Agent 为主的企业数据管理产品**"。Agent 从"UI 附属"变成"**独立服务**", 具备**主动能力** (定时巡检)、**预定义工作流** (Skills)、**多渠道触达** (Channel)、**任务队列** (长任务)、**短期记忆** (对话上下文)。

**核心目标**: 从"被动工具"变"主动产品"——周一早上 B 用户打开 UI 就看到"上周巡检报告", 而不是要自己跑去查。

**详细图**:
- 整体架构 → [07-whole-project-architecture.md](design-sketches/07-whole-project-architecture.md)
- 用户旅程 → [01-user-journey.md](design-sketches/01-user-journey.md)
- 切分方案 → [05-full-architecture-v1-scope.md](design-sketches/05-full-architecture-v1-scope.md) (本 spec 选 v1 切分的 **方案 2**)

## 2. 范围与非范围 (Scope)

### 2.1 v1 范围 (4-5 周, 1 工程师)

| 类别 | 项 |
|---|---|
| 新服务 | Agent Service (Node.js + Fastify + ws, port 4101) |
| 新数据 | `agent.*` schema (conversations / messages / tasks / task_steps / audit_log) |
| 新渠道 | WebChannel (替代 v0 /api/chat), CronChannel (周一 9 点巡检) |
| 新能力 | 短期记忆, 任务队列 (DB-backed), Skill Registry (Y 方案) |
| 新 Skill (5 个) | weekly-bank-review (v1 完整), qimai-revenue-anomaly / monthly-financial-summary / bulk-propose-rules / cashflow-anomaly (v1.1 补全) |
| 新 UI | `/u/notifications` 通知中心 |
| 配置层改造 | agent-config / agent.md / prompt.ts 从 Next.js 进程挪到 Agent 进程 |
| 测试 | 单元 + 集成 + 1-2 个 E2E |
| 部署 | 5 阶段切流 (shadow → canary → 灰度 → 全量 → 清理) |

### 2.2 明确不在 v1 范围 (YAGNI)

- ❌ 钉钉 Channel (v2)
- ❌ Webhook Channel (v2)
- ❌ 长期记忆 (你之前去掉了)
- ❌ 写入白名单 / 自治动作 (v2)
- ❌ pgvector 嵌入向量 (v2+)
- ❌ 知识图谱 (v3+)
- ❌ 多 Agent 协作 (v3+)
- ❌ A 用户 (老板) 的自然语言分析 (v2/v3)
- ❌ 多模态输入 (图片/pdf) (v2+)
- ❌ Agent 中途打断 (interrupt) (v2+)

## 3. 目标用户 (Target Users)

详见 [01-user-journey.md](design-sketches/01-user-journey.md) §B/A 旅程对比。

| 用户 | 角色 | v1 体验 | v2/v3 体验 |
|---|---|---|---|
| **B. 财务/运营分析师** (v1 主目标) | 懂业务, 但不想写 SQL/规则, 主要做核对和分类 | 在 ChatDrawer 自然语言问"上周怎么样", Agent 主动提建议; 周一早收到巡检报告 | (v1 已能用) |
| **A. 经营老板** (v2/v3 长期目标) | 不懂 SQL/规则, 只看报表的决策者 | (v1 不做) | 自然语言问"哪家店值得扩张", 派单给店长 |

**B 的反复使用沉淀出"规则库 + 解读语料"**, 让 A 后续的"自然语言问经营问题"有了真实的判断依据。

## 4. 架构 (Architecture)

### 4.1 应用与 Agent 的关系: B 模式

详见 [02-app-vs-agent-architecture.md](design-sketches/02-app-vs-agent-architecture.md)。

**Agent 是独立服务, UI 是它的客户端之一**。跟 v0 (Agent 嵌在 Next.js 进程) 的根本区别:
- v0: UI 进程挂, Agent 挂; 加新渠道要重打包 UI
- v1: Agent 独立, 24/7 跑; 加新渠道 = 加 Channel Adapter

### 4.2 5 层架构

详见 [07-whole-project-architecture.md](design-sketches/07-whole-project-architecture.md)。

```
① 用户/外部触点        浏览器 / 钉钉 (v2) / Webhook (v2) / Cron
② 客户端 / Channel     Next.js UI (既有) + ChatDrawer (改 endpoint)
③ Agent Service        ★ 唯一新增进程 (Node.js, port 4101)
④ 既有 Next.js API     REST + MCP 45 tools (完全复用, 0 改动)
⑤ 数据层               既有 schemas + agent.* (5 张新表)
⑥ 离线层 (Python)      不动
⑦ BI (Metabase)        不动
```

**改动范围 = 1 个新进程 + 1 个新 schema + 1 处 UI endpoint 改动 + 0 行 ETL/既有 API/业务表 改动。**

### 4.3 信任边界 (写权限)

| 操作 | 任何用户 (B/A) | 审批员 (admin) | Agent | 离线 ETL |
|---|:---:|:---:|:---:|:---:|
| 提问 / 查报表 | ✓ | ✓ | ✓ | |
| 触发任务 | ✓ | ✓ | ✓ | |
| 接收通知 | ✓ | ✓ | ✓ | |
| 调 MCP (读) | | ✓ | ✓ | |
| submit_proposal | | ✓ | ✓ | |
| upload_* | | ✓ | ✓ | |
| rerun_match | | ✓ | ✓ | |
| 审批 proposal | | ✓ | | |
| 改 cfg / rules | | ✓ | | |
| 写 ODS | | | | ✓ |
| **写 cfg / 改 schema / 直接写 DB** | **✗** | **✗** | **✗** | **✗** |

**决策权始终在人, Agent 是放大器, 不是替代者。**

## 5. Agent Core 内部组件 (Components)

Agent Service 内部由 6 个独立模块组成, 详见 [03-agent-core-internals.md](design-sketches/03-agent-core-internals.md)。

```
┌─────────────────────────────────────┐
│ Channel 适配层 (Web + Cron)          │  消息进出, 无业务
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Conversation Manager (短期记忆)      │  PG: conversations + messages
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Skill Registry (Y 方案)              │  description 常驻 + load_skill 展开
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Agent Runner (LLM 循环)              │  Anthropic SDK
└──────┬──────────────────┬───────────┘
       │                  │
       ▼                  ▼
┌──────────────┐  ┌──────────────────┐
│ MCP Bridge   │  │ Task Scheduler   │
│ (45 tools)   │  │ (DB-backed queue)│
└──────────────┘  └──────────────────┘
```

### 5.1 ConfigStore (配置层)

详见 [08-v1-config-layer.md](design-sketches/08-v1-config-layer.md) + [09-config-store-interface.md](design-sketches/09-config-store-interface.md)。

**v0 散落在 4 处的配置, v1 全部归到 Agent Service 一个 store**:
| 配置 | v0 位置 | v1 位置 |
|---|---|---|
| 业务指令 (agent.md) | `ui/src/lib/chat/agent.md` | `agent/agent.md` |
| LLM 调试参数 (7 个) | `agent-config-store.ts` | `agent/src/config/store.ts` |
| Credentials | `agent-config-store.ts` | `agent/src/config/store.ts` |
| System prompt 模板 | `prompt.ts` 硬编码字符串 | `agent/src/agent/prompt.ts` + `agent/skills/*.md` (Y 方案) |

**Admin UI 改为 5 行 fetch 代理**, 鉴权透传 (靠 header)。

### 5.2 Channel 抽象

详见 [10-channel-abstraction.md](design-sketches/10-channel-abstraction.md)。

**统一 `IncomingMsg` / `OutgoingMsg`** 是核心 —— 不管消息来自 Web/Cron/钉钉, Agent 内部处理逻辑完全一样。

**Web Channel 包了 v0 的 SSE 协议** —— 升级 v0→v1 时前端 0 改动, 只换 URL。
**Cron Channel 走 ChannelManager → TaskScheduler**, 复用审计/进度/重试逻辑。

### 5.3 Skill Registry (Y 方案)

详见 [11-skill-registry.md](design-sketches/11-skill-registry.md)。

**Y 方案**:
- 启动时扫 `agent/skills/*.md` → parse frontmatter → 内存 Map
- `listSkillDescriptions()` 进 system prompt (~500 tokens 常驻)
- LLM 调 `load_skill(name)` 展开全文 (~1K tokens 临时注入)
- v0 字符串 → v1 .md 是**纯内容搬家**, 文字不动

**v1 Skill 清单** (4 基线 + 1 业务, 完整展开):
- `wdg-data-platform.md` ← v0 `TOOL_USAGE_CONVENTIONS` (基线)
- `bank-classification.md` ← v0 `BANK_RULE` (基线)
- `financial-rates.md` ← v0 `FINANCIAL_RATE_RULE` (基线)
- `forbidden-shortcuts.md` ← v0 `FORBIDDEN` (基线)
- `weekly-bank-review.md` ← 新增业务 skill (Cron 周一 9 点自动跑, 也是 5 个 skill 中唯一完整展开的)

**v1.1 计划补全** (不在 v1 范围, 留作下一轮 brainstorm):
- `qimai-revenue-anomaly.md`
- `monthly-financial-summary.md`
- `bulk-propose-rules.md`
- `cashflow-anomaly.md`

(注: §2.1 "新 Skill (5 个)" 指的是 v1 完整上线后含 v1.1 补全的总数; v1 实际交付 5 个, v1 周交付 1 个完整业务 skill, 其余 4 个业务 skill 走 v1.1 补全)

### 5.4 McpBridge

详见 [12-mcp-bridge.md](design-sketches/12-mcp-bridge.md)。

80 行, 跟 v0 几乎一样, 多传 `x-wdg-user-id` header 用于审计。

### 5.5 Task Scheduler

详见 [13-task-scheduler.md](design-sketches/13-task-scheduler.md)。

**DB-backed queue** 用 `SELECT ... FOR UPDATE SKIP LOCKED`, 不引 Redis。**Handler 是 AsyncGenerator** —— `yield { step, status, result }` 每步一次, 自然支持进度推送。

### 5.6 Agent Runner (LLM 循环)

详见 [14-agent-runner.md](design-sketches/14-agent-runner.md)。

**胶水模块**, 不持数据, 把 6 个子模块串起来。**v0 的 13KB route.ts 拆成 7 个小文件**, 同样总代码量, 但独立可测。

### 5.7 Conversation Manager

详见 [15-conversation-manager.md](design-sketches/15-conversation-manager.md)。

**DB 为主**, 滑动窗口 + LLM 压缩旧消息 (haiku, 便宜)。**不做长期记忆** (你之前去掉了)。

## 6. 数据层 (Database)

### 6.1 新增 DDL

详见 [07 § 5](design-sketches/07-whole-project-architecture.md#5-数据层-postgresql-16-supabase) + [13 § 6](design-sketches/13-task-scheduler.md#6-跟-channel--agentrunner-的关系)。

```sql
CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE agent.conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  brand             TEXT,
  channel_id        TEXT NOT NULL,        -- 'web' | 'cron'
  status            TEXT NOT NULL DEFAULT 'active',
  summary           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent.messages (
  message_id        BIGSERIAL PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES agent.conversations(conversation_id),
  role              TEXT NOT NULL,        -- 'user' | 'assistant' | 'tool' | 'system'
  content           TEXT NOT NULL,
  tool_calls        JSONB,
  tool_results      JSONB,
  thinking          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_conv ON agent.messages(conversation_id, message_id);

CREATE TABLE agent.tasks (
  task_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id    UUID,
  conversation_id   UUID,
  user_id           TEXT,
  task_type         TEXT NOT NULL,
  input             JSONB,
  status            TEXT NOT NULL DEFAULT 'QUEUED',  -- NEW|QUEUED|RUNNING|DONE|FAILED|CANCELLED|PARTIAL
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
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  result            JSONB,
  error             JSONB,
  UNIQUE(task_id, step_index)
);

CREATE TABLE agent.audit_log (
  log_id            BIGSERIAL PRIMARY KEY,
  user_id           TEXT,
  conversation_id   UUID,
  task_id           UUID,
  action            TEXT NOT NULL,
  payload           JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_user ON agent.audit_log(user_id, created_at DESC);
```

**业务表零修改。**

## 7. 质量保证 (Quality)

### 7.1 错误处理

详见 [16-error-handling.md](design-sketches/16-error-handling.md)。

**5 类错误源, 各自有明确处理策略**:
| 错误源 | 例子 | 策略 |
|---|---|---|
| A. LLM 调用失败 | 401 / 429 / 5xx | 自动重试 (LLM_AUTH 立即停) |
| B. MCP 调用失败 | tool 不存在 / 参数错 / DB 视图未就绪 | **回灌给 LLM, 不在 AgentRunner 硬处理** |
| C. 任务执行失败 | handler 抛异常 / 超时 | 写 task.error, status=FAILED/PARTIAL |
| D. 鉴权失败 | 未登录 / 跨用户 | 401/403, 不重试 |
| E. 系统级失败 | DB 断 / 磁盘满 | fail loud, fail fast, Docker 重启 |

**关键**: MCP 错误回灌给 LLM, 让 LLM 自己决定改参数/换工具/告知用户 —— Y 方案"LLM 是工作流执行者"的体现。

### 7.2 测试策略

详见 [17-testing-strategy.md](design-sketches/17-testing-strategy.md)。

**3 层金字塔**:
- 单元 50-100 个 (`node:test` + `tsx`), mock LLM + mock MCP, <100ms 每个
- 集成 5-10 个 (pg-mem 跑测试 DB, Fastify.inject), <5s 每个
- E2E 1-2 个 (Playwright + 真实 dev server + 真 LLM), <60s

**覆盖率 75% 目标** (务实, 不追求 100%)。

### 7.3 部署 + 迁移 + 回滚

详见 [18-deployment-migration.md](design-sketches/18-deployment-migration.md)。

**5 阶段切流** (总 4 周):
1. **Shadow** (W5 末尾) — Agent 起, 没人连, cron 跑, 监控 5 天
2. **Canary** (W6) — 1-2 个 B 用户切流
3. **灰度** (W7) — 50% 切流, 监控 1 周
4. **全量** (W8) — 100% 切流, 稳定 1 周
5. **清理** (W10) — 删 v0 chat 代码

**回滚 3 档**:
- 秒级: 改 `AGENT_ROLLOUT_PERCENT=0` + 重启 ui
- 分钟级: 灰度回退
- 小时级: 核弹 `DROP SCHEMA agent CASCADE`

### 7.4 监控 + 告警 + 审计

详见 [19-monitoring-audit.md](design-sketches/19-monitoring-audit.md)。

**三层可观测性**:
- 业务指标 → /u/dashboard 新加 "Agent 健康" 卡片
- 系统指标 → Prometheus `/metrics` 端点 (`agent_llm_call_total` 等)
- 审计 → `agent.audit_log` 表 (跟 v0 `ops.pipeline_run` 模式一致)

**告警规则** (Prometheus YAML):
- LLM 错误率 > 5% (5 分钟)
- MCP 错误率 > 10% (5 分钟)
- 任务失败 > 3 次/小时
- 内存 > 500MB (10 分钟)
- P95 延迟 > 30s (5 分钟)

## 8. 5 周排期 (Schedule)

| 周 | 内容 | 关键交付 |
|---|---|---|
| W1 | DDL + Fastify 启动 + WebChannel + Conversation 持久化 | Agent Service 起, ChatDrawer 仍能走 v0 chat (fallback) |
| W2 | Skill Loader + load_skill tool + 1-2 个 skill 跑通 + ChatDrawer 改 endpoint | ChatDrawer 走 ws://agent:4101, 跑通 weekly-bank-review |
| W3 | MCP Bridge 补全 + 5 个 skill 全部就位 + 流式输出 + Token 监控 | 5 个 skill 跑通真实数据 |
| W4 | Task Scheduler (DB queue + 状态机) + Worker + Notifier (WS 推送) + CronChannel | 周一 9 点自动跑 weekly-bank-review, admin 收到通知 |
| W5 | E2E 测试 + 监控 + 文档 + 部署准备 (sql migrate + docker-compose + .env.example) | Shadow mode 上线 |

**总周期**: 4-5 周, 1 工程师。

## 9. 验收标准 (Acceptance Criteria)

v1 完成时, 下列项全部 ✓:

- [ ] **架构**: `docker compose up -d` 起 4 个服务 (db / ui / agent / metabase), agent health check 通过
- [ ] **配置迁移**: admin 在 `/u/admin/agent-config` 改 maxTokens, 下一个 WebSocket 消息 / Cron tick 生效
- [ ] **Skill 跑通**: 5 个 skill 各跑通至少 1 次真实数据, `load_skill` 机制工作
- [ ] **Cron 主动能力**: 周一 9 点, admin 在 `/u/notifications` 看到 weekly_bank_review 报告
- [ ] **任务队列**: 提交一个 5 步的 `monthly-financial-summary` 任务, 进度能在 UI 实时看到
- [ ] **错误处理**: 5 类错误源各自验证, 错误信息进 `agent.audit_log`
- [ ] **测试**: `npm test` 跑通, 覆盖率 ≥ 75%
- [ ] **既有项目不退化**: `pytest tests/ -v` 仍然 pass, `cd ui && npx next build` 仍然 succeed
- [ ] **监控**: `/metrics` 端点暴露 12+ 指标, Prometheus 能 scrape
- [ ] **审计**: admin 能在 `/u/notifications` 查任意用户近 100 条 audit log
- [ ] **文档**: `docs/superpowers/specs/2026-06-08-agent-first-product.md` (本文件) + 19 个 design-sketch + 更新过的 README.md

## 10. 演进路径 (Evolution)

| 版本 | 主题 | 关键变化 |
|---|---|---|
| **v1** (本 spec, 4-5 周) | Agent 底座 + 主动能力 | Agent Service 上线, 5 个 skill, Cron 巡检, 任务队列 |
| **v2** | 多渠道 + 写入白名单 | 钉钉 Channel, 自动 refresh snapshot, 写权限分级 |
| **v3** | 老板视角 (A 用户) | 自然语言问经营, 派单, 知识图谱 (可选) |

## 11. 风险与权衡 (Risks & Trade-offs)

| 风险 | 影响 | 缓解 |
|---|---|---|
| LLM 输出不稳定 | E2E 测试偶发失败 | Mock 全部 LLM, E2E 用确定性 prompt |
| TaskScheduler 用 PG queue 性能不够 | 高并发任务积压 | v1 默认 2 worker, 监控队列长度, 超 50 告警 |
| ChatDrawer 升级时漏改 | 用户 502 | 双跑 (Shadow), 5 阶段切流, 灰度观察 1 周 |
| agent.config.apiKey 泄漏 | 财务损失 | secret-crypto 加密, audit log 记录所有 config 变更 |
| Skill 写错导致循环调 MCP | token 浪费 | maxToolChainDepth 限 10, token 监控, 超 200K 强停 |

## 12. 关键决策记录 (Decision Log)

| # | 决策 | 原因 | 替代方案 |
|---|---|---|---|
| D1 | Agent 独立服务 (B 模式) | 主动能力 / 任务队列 / 记忆 / 多渠道 都需独立进程 | 嵌在 Next.js (A 模式) — 否决 |
| D2 | Node.js / TypeScript 实现 | 前端工程师能上手, WebSocket 原住民 | Python — 否决 (跟 UI 不同语言) |
| D3 | Y 方案 Skill (按需展开) | 100+ skill 也能 scale | X 方案 (全量塞) — v1 临时方案 |
| D4 | 不做长期记忆 | 用户决定简化, 走 Skills 路线 | 长期记忆 — 否决 |
| D5 | DB-backed queue (PG `FOR UPDATE SKIP LOCKED`) | 不引 Redis, 沿用 PG | Redis/Celery — 引入新依赖, 暂不需要 |
| D6 | 5 阶段切流 | 风险最小, 出问题秒回 | 一步全量 — 风险大 |
| D7 | v0 chat 保留 4 周作为 fallback | 升级时回滚秒级 | 直接删 v0 chat — 太激进 |
| D8 | v1 5 个 skill, v1.1 再补 | 5 个已能演示主动能力 | 一次做 10 个 skill — 风险大 |

## 13. 参考资料 (References)

### 13.1 项目内

- [CLAUDE.md](../../CLAUDE.md) — 项目根 CLAUDE.md
- [docs/architecture.md](../architecture.md) — 既有架构 (v0 视角)
- [docs/mcp-tools.md](../mcp-tools.md) — MCP 45 tools 清单
- [docs/qmaireport/README.md](../qmaireport/README.md) — 全站银行数据审计
- [ui/src/lib/chat/agent-config-store.ts](../../ui/src/lib/chat/agent-config-store.ts) — v0 配置层 (要被迁)
- [ui/src/lib/chat/prompt.ts](../../ui/src/lib/chat/prompt.ts) — v0 prompt 模板 (要被拆)
- [docs/superpowers/specs/2026-06-06-agent-config-ui.md](2026-06-06-agent-config-ui.md) — admin UI 设计 (v0)

### 13.2 设计 sketch (本 brainstorm 产物)

`docs/superpowers/design-sketches/` 目录下 19 个文件, 本 spec 各章节已交叉引用。

### 13.3 外部

- [Anthropic Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) — Skills 设计参考
- [Anthropic Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) — thinking budget
- [PostgreSQL SELECT FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE) — 任务队列并发
- [Fastify](https://fastify.dev/) — Node.js web framework
- [ws](https://github.com/websockets/ws) — WebSocket 库

## 14. Open Questions (待 review 时确认)

1. ~~**Agent Service 部署形态**: 单进程单容器, 还是单进程多 worker? (倾向单进程, Node.js 单线程够用)~~ **已答**: 单进程单容器
2. ~~**Skill 数量上限**: 100 个 Skill 会让 `listSkillDescriptions()` 涨到 5K tokens, 还能接受。1000 个呢? (v1 不考虑, v2 加 Skill 分类/搜索)~~ **v1 不考虑**, 留 v2
3. ~~**Cron 失败重试**: v1 不做自动重试, 任务失败后人工看。v2 是否加? (倾向 v2 加)~~ **已答**: v1 不做自动重试
4. ~~**多品牌并行任务**: 如果周一 9 点同时跑 yufeng 和 bonjur 的 weekly review, 会同时占 2 worker (v1 默认 2 worker)。要扩到 4 worker 吗? (倾向 v1 就 4 worker, 留点余量)~~ **已答**: 4 workers
5. ~~**/u/notifications 权限**: 谁能看到所有通知? admin only? 还是有 "自己看自己的" 模式? (v1 倾向所有用户看自己 + admin 看全部)~~ **已答**: 用户看自己 + admin 看全部

## 15. 复核后的关键参数 (Consolidated Parameters)

| 参数 | 值 | 出处 |
|---|---|---|
| Agent 部署形态 | 单进程单容器 | Q1 |
| Cron 失败重试 | v1 不做 (人工看通知, 手动 rerun) | Q3 |
| TaskScheduler worker 数 | 4 | Q4 |
| /u/notifications 权限 | 用户看自己 + admin 看全部 | Q5 |
| maxToolChainDepth | 10 (来自 ConfigStore 默认) | §5.1 |
| tokenSoftLimit | 80,000 (来自 ConfigStore 默认) | §5.1 |
| tokenHardLimit | 200,000 (来自 ConfigStore 默认) | §5.1 |
| thinkingLevel | off (默认) | §5.1 |
| mcpRetryMaxAttempts | 2 (默认) | §5.1 |
| Cron timezone | Asia/Shanghai | §5.2 |
| Skill 加载策略 | Y 方案 (按需展开) | §5.3 |
| 切流总周期 | 4 周 (Shadow + Canary + 灰度 + 全量) | §7.3 |

---

**Spec 版本**: v1.0-draft
**下一步**: Self-review → User review → writing-plans
