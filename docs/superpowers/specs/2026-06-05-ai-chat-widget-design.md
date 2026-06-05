# AI 聊天助手设计

## 1. 概述

在现有 WDG 数据平台 UI 中新增"AI 聊天助手"功能。用户在任意页面右下角唤起悬浮聊天窗，通过自然语言与 Claude 沟通数据；后端 Claude Opus 4.8 自主调用现有 45 个 MCP 工具（`POST /api/mcp`）取数、生成回答。

底层模型：Anthropic Claude Opus 4.8（`@anthropic-ai/sdk`），通过官方 API 调用。
工具复用：完全复用现有 `POST /api/mcp` JSON-RPC 端点，零业务侵入、写权限与审计天然继承。
UI 形态：全局右下角悬浮窗（`ChatWidget`），单聊 + "重置"按钮；监听 `Cmd/Ctrl+K` 唤起。
上下文：与当前页面的 `brand` / `store` / `period` / `page` 自动联动。

## 2. 范围

### 包含

- 服务端 SSE 端点 `POST /api/chat`：跑 Claude API 工具循环，stream 进度
- 服务端辅助端点 `GET /api/chat/history`（拉历史） / `POST /api/chat/context`（上下文差量）
- UI 组件：`ChatWidget` / `MessageList` / `ChatInput` / `PageContext`（React Context）
- 工具 schema 动态加载：每次启动从 `GET /api/mcp tools/list` 拉，避免硬编码
- 角色化工具裁剪：基于现有 `getSessionUser()` 与角色白名单
- 文件上传：聊天框内 📎 走 multipart → 落到 `inputs/` → 调 `upload_*` 工具
- Excel 导出联动：store-report 类查询自动生成 `outputs/` 下的 xlsx，前端展示"下载"按钮
- 审计：新增 `ops.chat_session_log` / `ops.chat_tool_call` 两张表
- 速率限制：60s 内最多 10 条消息
- 单元 + 集成测试（mock Claude SDK 与 `/api/mcp`）

### 不包含（一期 YAGNI）

- ❌ 多会话历史侧边栏（一期单聊 + "重置"按钮）
- ❌ 聊天历史持久化（先做进程内存 30 分钟 TTL，schema 留好）
- ❌ 语音输入
- ❌ 多模型切换（锁死 Opus 4.8）
- ❌ 工具调用的人工接管（一期 Claude 全自动）
- ❌ 工具调用过程的动画 / 进度条
- ❌ 跨用户 / 跨设备会话同步

## 3. 架构

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                 │
│  ┌─────────────────────────────────────────┐             │
│  │  ChatWidget (floating, bottom-right)    │             │
│  │  - PageContext subscriber               │             │
│  │  - messages[] state                     │             │
│  │  - SSE consumer                         │             │
│  │  - 📎 upload + 📥 download              │             │
│  └──────────┬──────────────────────────────┘             │
│             │ POST /api/chat (multipart, SSE)            │
└─────────────┼────────────────────────────────────────────┘
              ▼
┌──────────────────────────────────────────────────────────┐
│  ui/src/app/api/chat/route.ts (NEW)                      │
│  ┌─────────────────────────────────────────┐             │
│  │  Anthropic SDK client (Opus 4.8)        │             │
│  │  - tools = loadMcpToolSchemas()         │             │
│  │  - system = buildSystemPrompt(ctx)      │             │
│  │  - loop: tool_use → POST /api/mcp       │             │
│  │         → tool_result → 回喂对话        │             │
│  │  - SSE: text_delta | tool_start |       │             │
│  │         tool_end | done | error         │             │
│  └──────────┬──────────────────────────────┘             │
│             │ JSON-RPC 2.0                                │
└─────────────┼────────────────────────────────────────────┘
              ▼
┌──────────────────────────────────────────────────────────┐
│  ui/src/app/api/mcp/route.ts (EXISTING, unchanged)       │
│  - 45 tools, write whitelist, audit log                   │
└──────────────────────────────────────────────────────────┘
```

**为什么 SSE 而不是 WebSocket**：聊天是一问一答单向流，SSE 简单；上传走 multipart form。降复杂度。

**为什么 server 跑 Agent 循环**：45 个工具里包含 DB 直查、文件落 `raw` schema、提案提交，全部必须服务端跑（DB 凭证、`getSessionUser()` 鉴权、文件写入）。前端只发用户消息与当前页面上下文。

## 4. 组件与数据流

### 4.1 UI 组件（`ui/src/components/chat/` 新增）

| 文件 | 职责 |
|---|---|
| `ChatWidget.tsx` | 悬浮窗外壳。固定右下角 32px 边距，展开 420×600；`Cmd/Ctrl+K` 全局唤起；最小化/关闭按钮 |
| `MessageList.tsx` | 消息列表。5 种 type：`user` \| `assistant_text` \| `tool_call`（可展开） \| `tool_result`（默认折叠在 tool_call 下） \| `error` |
| `ChatInput.tsx` | 文本框 + 📎 上传按钮 + 发送按钮 + 重置按钮。文件走 multipart 同 `/api/chat` |
| `PageContext.tsx` | React Context。提供 `{ brand, store, period, page }` |
| `types.ts` | `Message` / `ToolCall` / `SseEvent` 类型定义 |

### 4.2 上下文同步

页面切换时（`/u/financial?brand=bonjur&store=wz_ra&period=2026-04`），把 `{ brand, store, period, page }` 写进 `PageContext`。`ChatWidget` 订阅该 context，context 变时 POST `/api/chat/context`，服务端把这 4 个字段塞进 system prompt 前缀。

### 4.3 服务端循环（伪代码）

```ts
// /api/chat/route.ts
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const tools = await loadMcpToolSchemas();   // 调 GET /api/mcp tools/list
const system = buildSystemPrompt(pageCtx);

const stream = client.messages.stream({
  model: 'claude-opus-4-8',
  system, tools, messages: history,
  max_tokens: 4096,
});

for await (const event of stream) {
  if (event.type === 'content_block_start' && event.block.type === 'tool_use') {
    sseSend({ type: 'tool_start', name: event.block.name, id: event.block.id });
  }
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    sseSend({ type: 'text_delta', text: event.delta.text });
  }
  // tool_use 收齐后 → 调 /api/mcp → 拿结果 → 喂回下一轮
  // 循环直到 stop_reason === 'end_turn'
}
```

### 4.4 文件上传

聊天框 📎 选文件 → 前端塞进 multipart → POST `/api/chat`（同端点 + `files` 字段）→ 服务端落 `inputs/<date>/` → 调 `upload_bank_txn_file` 等 upload 工具 → 工具返回 `sourceFileId` → assistant 消息追加"已上传，源文件 ID 42，5 条未分类"。

### 4.5 Excel 导出联动

`query_store_report_snapshot` 工具返回后，服务端额外生成 `outputs/<date>/store-report-{brand}-{store}-{month}.xlsx`（复用现有 `xlsx-js-style` 导出逻辑），返回时带 `attachment_url`。前端在 `tool_result` 折叠区渲染"📥 下载 Excel"链接。

## 5. 鉴权与权限

复用现有 `getSessionUser()`（[ui/src/lib/auth-server.ts](../../ui/src/lib/auth-server.ts)）：

| 角色 | 可用工具 |
|---|---|
| 未登录 | 401，前端显示"请先登录" |
| 普通员工 | 38 个只读工具，过滤掉 `upload_*` / `rerun_match_by_file` / `submit_proposal` |
| admin / finance / store_manager | 完整 45 工具 |

实现：`filterToolsByRole(role, allTools)` 在加载时裁剪 `tools` 数组；服务端再过一道 `ALLOWED_WRITE_TOOLS` 白名单（`Set<string>`）防止 prompt 注入让 AI 调已被撤的工具（如 `create_rule` / `export_rules` / `xintiandi.*`）。

工具白名单（与 [wdg-data-platform](../../docs/skills/wdg-bank-workflow-SKILL.md) 技能一致）：

```ts
const ALLOWED_WRITE_TOOLS = new Set([
  'upload_bank_txn_file',
  'upload_gelatomiiix_income_detail',
  'upload_bonjur_income_detail',
  'upload_bonjur_product_sales',
  'upload_bonjur_sales_self_service',
  'upload_tamkoko_inventory',
  'submit_proposal',
  'rerun_match_by_file',
]);
```

## 6. 错误处理

| 失败模式 | 处理 |
|---|---|
| Anthropic API 429/529 | 重试 2 次，指数退避；前端显示"AI 服务繁忙" |
| Anthropic API 401/403 | 服务端日志记录"ANTHROPIC_API_KEY 未配置/失效"，前端显示"服务未配置" |
| tool_use 调 `/api/mcp` 4xx/5xx | `tool_result: { isError: true, content }` 让 Claude 自己改；折叠区显示 ⚠️ |
| tool_use 5xx 重试 2 次仍失败 | 同上 + 前端高亮该步骤为红色 |
| 上传文件 > 10MB | 返回 413，前端提示 |
| SSE 连接断开 | 前端自动重连一次，恢复消息历史（GET `/api/chat/history`） |
| Claude 单轮调 10+ 工具 | 强制终止循环，提示"任务过于复杂" |
| 命中 `ALLOWED_WRITE_TOOLS` 黑名单 | `tool_result: { error: "WRITE_NOT_ALLOWED" }`，折叠区显示"权限不足" |

## 7. 数据与隐私

- **不直连 DB**（项目硬约束）：所有数据经 `/api/mcp`
- **不发送敏感字段到 Claude**：
  - tool 返回里若含 `email` / `phone` / `id_card` → 服务端先脱敏再喂给 Claude（接口预留，本期 schema 无此类字段）
  - DB 连接串、API key 永远不出服务端
- **聊天历史**：
  - 一期：进程内存 `Map<sessionId, Message[]>`，30 分钟无活动清空
  - 二期（已留 schema）：持久化到 `ops.chat_session_log`
- **关闭浏览器 / 点"重置"** → 服务端 + 客户端都清空

## 8. 速率限制

- 同一用户 60 秒内最多 10 条消息（防止 token 消耗失控）
- 超过 → 返回 429，前端显示"慢一点"
- 实现：内存 `Map<userId, number[]>` 滑动窗口

## 9. 审计

新增两张表（`sql/00_infrastructure/80_chat_audit_ddl.sql`）：

```sql
CREATE TABLE ops.chat_session_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  message_count INT DEFAULT 0,
  tool_call_count INT DEFAULT 0,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(10,4) DEFAULT 0
);

CREATE TABLE ops.chat_tool_call (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES ops.chat_session_log(id),
  tool_name TEXT NOT NULL,
  tool_input JSONB,
  tool_result_summary TEXT,  -- 不存完整结果（可能很大）
  is_error BOOLEAN DEFAULT FALSE,
  duration_ms INT,
  called_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_tool_call_session ON ops.chat_tool_call(session_id);
CREATE INDEX idx_chat_session_log_user ON ops.chat_session_log(user_id);
```

## 10. 测试与验收

### 10.1 单元测试（vitest + pytest）

| 测什么 | 工具 | 文件 |
|---|---|---|
| `buildSystemPrompt(ctx)` 正确拼接 | vitest | `tests/chat/prompt.test.ts` |
| `filterToolsByRole(role, allTools)` 正确裁剪 | vitest | `tests/chat/auth.test.ts` |
| `toolUseToMcpRequest(block)` 正确转 JSON-RPC | vitest | `tests/chat/mcp-bridge.test.ts` |
| SSE 事件序列化/反序列化 | vitest | `tests/chat/sse.test.ts` |
| `ops.chat_session_log` / `ops.chat_tool_call` DDL 可执行 | pytest | `tests/test_chat_ddl.py` |

### 10.2 集成测试

- `vi.mock('anthropic')` 替换 SDK 返回预设 `tool_use` 序列
- `msw` 拦截 `/api/mcp`，预置 fixture（get_brand_stores 返回 bonjur/wz_ra/wz_wxc）
- 验证：用户发"瑞安 4 月销售" → 先调 get_brand_stores → 再调 query_bonjur_sales_summary → 拼回复

### 10.3 不做的事

- ❌ 不调真实 Claude API（不可重现、贵、不稳定）
- ❌ 不写 E2E（Playwright 跑聊天慢且脆弱）

### 10.4 手动验收清单（写到 `docs/chat-acceptance.md`）

1. 登录后任意页面，悬浮窗能正常打开
2. 切到 `/u/financial?brand=bonjur&store=wz_ra&period=2026-04` → 提问"这个月营收多少" → AI 答出数字
3. 聊天框里点 📎 上传一个银行流水 Excel → AI 报告"已上传 sourceFileId=N"
4. 让 AI 生成 store-report → 出现"导出 Excel"按钮，下载 xlsx 单元格格式不变
5. 故意触发一次失败 tool（`query_store_report_snapshot` 带不存在的 store）→ AI 自动改问用户
6. 用普通员工账号登录 → 上传文件按钮禁用并显示"权限不足"tooltip（不隐藏，让用户知道功能存在但当前不可用）；调 `upload_*` 工具时 server 端返回 `WRITE_NOT_ALLOWED`
7. 按"重置" → 历史清空，AI 重新问"哪个品牌/门店"
8. 看 `ops.chat_session_log` 多了一行，`ops.chat_tool_call` 有 N 行

### 10.5 验收目标

- `cd ui && npx next build` 成功
- `pytest tests/ -v` 全过（含新 `test_chat_ddl.py`）
- `npx tsc --noEmit` 0 错误
- 新增 5 个测试文件全过
- 8 条人肉验收清单全过

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Opus 4.8 单次对话太贵 | 温度 0.3，`max_tokens` 4096，调用链深度限 5 |
| Claude 幻觉给出 DB 不存在的数字 | system prompt 强制 "Use tools. Don't make up numbers."；用 tool_use 截断 |
| `/api/mcp` 工具 schema 改了，chat 端点没跟上 | `loadMcpToolSchemas()` 每次启动从 `/api/mcp tools/list` 拉，零代码改动 |
| prompt 注入让 AI 调 `export_rules` / `xintiandi.*` 等已撤工具 | 加载 tools 时跳过 `xintiandi.*`；写白名单服务端兜底 |
| 上传文件落盘占用空间 | 文件落到 `inputs/<date>/`，运维定期清理（一期不实现，靠人工） |

## 12. 文件清单

**分支**：`feat/ai-chat-widget`（基于 `main`）

**新增**（约 15 个文件）：

```
ui/src/components/chat/
  ├── ChatWidget.tsx
  ├── MessageList.tsx
  ├── ChatInput.tsx
  ├── PageContext.tsx
  └── types.ts

ui/src/app/api/chat/
  ├── route.ts              # POST SSE 端点
  ├── history/route.ts      # GET 当前会话历史
  └── context/route.ts      # POST 上下文差量

ui/src/lib/chat/
  ├── prompt.ts             # buildSystemPrompt
  ├── auth.ts               # filterToolsByRole
  ├── mcp-bridge.ts         # toolUse → JSON-RPC
  └── stream.ts             # SSE 编解码

ui/src/app/u/layout.tsx     # 修改：注入 PageContext + 挂载 ChatWidget
sql/00_infrastructure/
  └── 80_chat_audit_ddl.sql # 新增 DDL

tests/chat/
  ├── prompt.test.ts
  ├── auth.test.ts
  ├── mcp-bridge.test.ts
  └── sse.test.ts

tests/test_chat_ddl.py

docs/superpowers/specs/2026-06-05-ai-chat-widget-design.md
docs/chat-acceptance.md
```

**修改**（约 3 个文件）：

- `ui/src/app/u/layout.tsx` — 注入 PageContext + 挂载 ChatWidget
- `ui/.env.example` — 加 `ANTHROPIC_API_KEY=...`
- `ui/package.json` — 新增依赖 `@anthropic-ai/sdk`
