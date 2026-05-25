# 银行流水 Agent 上传与审批系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent 提供银行流水上传 + LLM 分类推理 + 人工审批的完整 MCP 工具链，适配 Claude Code Desktop / Hermes / Cline / Cursor。

**Architecture:** MCP Server 内嵌 Next.js（端口 4100），通过 HTTP + JSON-RPC 暴露标准 MCP 工具。审批提案存储于 `ops.approval_proposal`，审批 UI 复用已有 `settle-batch` 接口执行分类规则。

**Tech Stack:** Next.js API Routes + MCP SDK (`@modelcontextprotocol/server`) + TypeScript + TailwindCSS + 已有 PostgreSQL 池

---

## 文件变更总览

| 操作 | 文件 |
|------|------|
| 创建 | `ui/src/app/api/mcp/route.ts` — MCP 协议入口 |
| 创建 | `ui/src/mcp/server.ts` — MCP Server 实例 + 工具注册 |
| 创建 | `ui/src/mcp/tools/*.ts` — 工具实现（6 个文件） |
| 创建 | `ui/src/app/api/approval/proposals/route.ts` — 提案 CRUD |
| 创建 | `ui/src/app/api/approval/proposals/[id]/route.ts` — 单条修改 |
| 创建 | `ui/src/app/api/approval/proposals/batch-action/route.ts` — 批量审批 |
| 创建 | `ui/src/app/u/approvals/page.tsx` — 审批 UI |
| 创建 | `supabase/migrations/2026-05-25_approval_proposal.sql` — 新表 |
| 创建 | `ui/src/app/api/approval/proposals/[id]/route.ts` — 审批执行后回调 |
| 修改 | `ui/src/lib/query-types.ts` — 新增 ApprovalProposal 类型 |
| 创建 | `ui/.mcp.json` — Claude Code Desktop MCP 配置 |

---

## Task 1: 创建数据库迁移

**Files:**
- Create: `supabase/migrations/2026-05-25_approval_proposal.sql`
- Test: `psql` 直接验证表创建

- [ ] **Step 1: 编写迁移 SQL**

```sql
-- supabase/migrations/2026-05-25_approval_proposal.sql
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.approval_proposal (
  proposal_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       UUID        NOT NULL,
  source_file_id INT         NOT NULL,
  bank_txn_id    BIGINT      NOT NULL,
  brand_code     TEXT        NOT NULL DEFAULT 'yufeng',

  type           TEXT        NOT NULL CHECK (type IN ('type1', 'type2')),
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'executed', 'timeout')),

  -- LLM 推荐（type1）
  llm_lvl1_code    TEXT,
  llm_lvl2_code    TEXT,
  llm_keyword      TEXT,
  llm_match_field  TEXT,
  llm_confidence   TEXT,
  llm_reasoning    TEXT,
  -- LLM 标记（type2）
  llm_missing_fields TEXT[],

  -- 用户最终决策
  final_lvl1_code    TEXT,
  final_lvl2_code    TEXT,
  final_keyword      TEXT,
  final_match_field  TEXT,
  user_note          TEXT,
  resolved_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ
);

CREATE INDEX idx_approval_proposal_batch_id  ON ops.approval_proposal(batch_id);
CREATE INDEX idx_approval_proposal_status    ON ops.approval_proposal(status);
CREATE INDEX idx_approval_proposal_source    ON ops.approval_proposal(source_file_id);
CREATE INDEX idx_approval_proposal_brand     ON ops.approval_proposal(brand_code);

-- 审批执行后的 cross-link（指向 ops.unclassified_resolution_log）
ALTER TABLE ops.approval_proposal ADD COLUMN resolution_log_id BIGINT;
```

- [ ] **Step 2: 运行迁移**

Run: `psql "$DATABASE_URL" -f supabase/migrations/2026-05-25_approval_proposal.sql`
Expected: `CREATE TABLE` 输出，确认表存在

- [ ] **Step 3: 验证表结构**

Run: `psql "$DATABASE_URL" -c "\d ops.approval_proposal"`
Expected: 显示所有列和索引

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-05-25_approval_proposal.sql
git commit -m "feat(db): add ops.approval_proposal table for agent approval workflow"
```

---

## Task 2: 创建 MCP Server 工具实现

**Files:**
- Create: `ui/src/mcp/tools/upload-bank-txn.ts`
- Create: `ui/src/mcp/tools/get-unclassified.ts`
- Create: `ui/src/mcp/tools/submit-proposal.ts`
- Create: `ui/src/mcp/tools/query-status.ts`
- Create: `ui/src/mcp/tools/get-rules.ts`
- Create: `ui/src/mcp/tools/get-candidates.ts`
- Create: `ui/src/mcp/tools/get-txn-detail.ts`

- [ ] **Step 1: 创建 upload-bank-txn.ts 工具**

复用已有的 `/api/upload` 接口（已有 `triggerImport=true` 逻辑）。工具本身是 MCP 层的 thin wrapper。

```typescript
// ui/src/mcp/tools/upload-bank-txn.ts
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { execSync } from 'child_process';

const UploadBankTxnInput = z.object({
  brand:      z.string().describe('Brand code: yufeng | gelatomiiix | bonjur'),
  store:      z.string().describe('Store code'),
  file_path:  z.string().describe('Absolute path to the bank statement file (xlsx)'),
});

export const uploadBankTxnTool = {
  name: 'upload_bank_txn_file',
  description: 'Upload a bank statement Excel file, trigger import pipeline, and return file_id + row count.',
  inputSchema: UploadBankTxnInput,
  async execute({ brand, store, file_path }: z.infer<typeof UploadBankTxnInput>) {
    // 读取文件并计算 SHA-256
    const fileBuffer = await readFile(file_path);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 构造 FormData 调用 /api/upload
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), file_path.split('/').pop()!);
    form.append('brand', brand);
    form.append('store', store);
    form.append('source', 'bank');
    form.append('triggerImport', 'true');

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' }, // 内部调用标识
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload failed: ${err}`);
    }

    return await res.json();
  },
};
```

- [ ] **Step 2: 创建 get-unclassified.ts 工具**

调用 `/api/match?brand=yufeng&month=2026-05`，返回未匹配交易列表。

```typescript
// ui/src/mcp/tools/get-unclassified.ts
import { z } from 'zod';

const GetUnclassifiedInput = z.object({
  brand: z.string().default('yufeng'),
  month: z.string().optional().describe('YYYY-MM format, e.g. 2026-05'),
});

export const getUnclassifiedTool = {
  name: 'get_unclassified_transactions',
  description: 'Get list of unclassified bank transactions. These are the records that need LLM-assisted classification proposals.',
  inputSchema: GetUnclassifiedInput,
  async execute({ brand, month }: z.infer<typeof GetUnclassifiedInput>) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const url = new URL(`${baseUrl}/api/match`);
    url.searchParams.set('brand', brand);
    if (month) url.searchParams.set('month', month);

    const res = await fetch(url.toString());
    const data = await res.json();
    return { count: data.length, transactions: data };
  },
};
```

- [ ] **Step 3: 创建 get-rules.ts、get-txn-detail.ts、get-candidates.ts**

参考已有 API `/api/rules`、`/api/match/{id}`、`/api/match/candidates`，直接调用后返回结构化数据。

- [ ] **Step 4: 创建 submit-proposal.ts 工具**

```typescript
// ui/src/mcp/tools/submit-proposal.ts
const SubmitProposalInput = z.object({
  source_file_id: z.number(),
  brand: z.string(),
  records: z.array(z.object({
    bank_txn_id:   z.number(),
    type:          z.enum(['type1', 'type2']),
    llm_proposal:   z.object({
      lvl1_code:   z.string(),
      lvl2_code:   z.string(),
      keyword:     z.string(),
      match_field:  z.string(),
      confidence:   z.enum(['high', 'medium', 'low']),
      reasoning:    z.string(),
    }).nullable(),
    missing_fields: z.array(z.string()).optional(),
    reasoning:      z.string(),
  })),
});

export const submitProposalTool = {
  name: 'submit_approval_proposal',
  description: 'Submit LLM-generated classification proposals to the approval queue. Proposals are stored and presented to the user for review.',
  inputSchema: SubmitProposalInput,
  async execute(input: z.infer<typeof SubmitProposalInput>) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const res = await fetch(`${baseUrl}/api/approval/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  },
};
```

- [ ] **Step 5: 创建 query-status.ts 工具**

```typescript
// ui/src/mcp/tools/query-status.ts
const QueryStatusInput = z.object({
  batch_id:   z.string().uuid(),
  brand:      z.string().default('yufeng'),
});

export const queryStatusTool = {
  name: 'query_approval_status',
  description: 'Poll the approval status of a previously submitted proposal batch. Returns counts by status.',
  inputSchema: QueryStatusInput,
  async execute({ batch_id, brand }: z.infer<typeof QueryStatusInput>) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const res = await fetch(`${baseUrl}/api/approval/proposals?batch_id=${batch_id}&brand=${brand}`);
    const proposals = await res.json();

    const grouped = {
      pending:   proposals.filter((p: any) => p.status === 'pending'),
      approved:  proposals.filter((p: any) => p.status === 'approved'),
      rejected:  proposals.filter((p: any) => p.status === 'rejected'),
      modified:  proposals.filter((p: any) => p.status === 'modified'),
      executed:  proposals.filter((p: any) => p.status === 'executed'),
    };

    return {
      batch_id,
      total: proposals.length,
      ...Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, (v as any[]).length])),
      detail_url: `${baseUrl}/u/approvals?batch=${batch_id}`,
    };
  },
};
```

- [ ] **Step 6: 验证所有工具类型正确**

Run: `cd ui && npx tsc --noEmit src/mcp/tools/*.ts`
Expected: 无编译错误

- [ ] **Step 7: Commit**

```bash
git add ui/src/mcp/tools/
git commit -m "feat(mcp): add bank txn MCP tools implementation"
```

---

## Task 3: 创建 MCP Server 路由

**Files:**
- Create: `ui/src/mcp/server.ts` — MCP Server 实例
- Create: `ui/src/app/api/mcp/route.ts` — Next.js 路由处理 MCP HTTP 请求

- [ ] **Step 1: 创建 MCP Server 实例**

```typescript
// ui/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  uploadBankTxnTool,
  getUnclassifiedTool,
  getTxnDetailTool,
  getCandidatesTool,
  getRulesTool,
  submitProposalTool,
  queryStatusTool,
} from './tools/index.js';

let _server: McpServer | null = null;

export function createMcpServer(): McpServer {
  if (_server) return _server;

  _server = new McpServer({
    name: 'wdg-bank-agent',
    version: '1.0.0',
  });

  _server.registerTool(uploadBankTxnTool.name, {
    description: uploadBankTxnTool.description,
    inputSchema: uploadBankTxnTool.inputSchema,
    // @ts-ignore - execute signature
  }, uploadBankTxnTool.execute);

  _server.registerTool(getUnclassifiedTool.name, {
    description: getUnclassifiedTool.description,
    inputSchema: getUnclassifiedTool.inputSchema,
  }, getUnclassifiedTool.execute);

  _server.registerTool(getTxnDetailTool.name, {
    description: getTxnDetailTool.description,
    inputSchema: getTxnDetailTool.inputSchema,
  }, getTxnDetailTool.execute);

  _server.registerTool(getCandidatesTool.name, {
    description: getCandidatesTool.description,
    inputSchema: getCandidatesTool.inputSchema,
  }, getCandidatesTool.execute);

  _server.registerTool(getRulesTool.name, {
    description: getRulesTool.description,
    inputSchema: getRulesTool.inputSchema,
  }, getRulesTool.execute);

  _server.registerTool(submitProposalTool.name, {
    description: submitProposalTool.description,
    inputSchema: submitProposalTool.inputSchema,
  }, submitProposalTool.execute);

  _server.registerTool(queryStatusTool.name, {
    description: queryStatusTool.description,
    inputSchema: queryStatusTool.inputSchema,
  }, queryStatusTool.execute);

  return _server;
}
```

- [ ] **Step 2: 创建 MCP HTTP 路由**

Next.js API Route 处理 MCP over HTTP（用于 HTTP Client，如 curl 测试）。

```typescript
// ui/src/app/api/mcp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createMcpServer } from '@/mcp/server';
import { NodeHttpStreamableHTTPServerTransport } from '@modelcontextprotocol/server/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const server = createMcpServer();
    const transport = new NodeHttpStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    // 将 Next.js 请求转发给 MCP transport
    const body = await request.json();
    const mcpResponse = await transport.handleRequest({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    } as any);

    return NextResponse.json(mcpResponse.body, { status: mcpResponse.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'wdg-bank-agent',
    version: '1.0.0',
    description: 'MCP server for WDG bank transaction workflow',
    tools: [
      'upload_bank_txn_file',
      'get_unclassified_transactions',
      'get_transaction_detail',
      'get_candidates',
      'get_existing_rules',
      'submit_approval_proposal',
      'query_approval_status',
    ],
  });
}
```

- [ ] **Step 3: 安装 MCP 依赖**

Run: `cd ui && npm install @modelcontextprotocol/server @modelcontextprotocol/sdk`
Expected: 安装成功，无 peer dependency 冲突

- [ ] **Step 4: 类型检查**

Run: `cd ui && npx tsc --noEmit`
Expected: 无编译错误

- [ ] **Step 5: Commit**

```bash
git add ui/src/mcp/ ui/src/app/api/mcp/
git commit -m "feat(mcp): add MCP server with bank txn workflow tools"
```

---

## Task 4: 创建 Approval API 路由

**Files:**
- Create: `ui/src/app/api/approval/proposals/route.ts` — POST（提交）/ GET（查询）
- Create: `ui/src/app/api/approval/proposals/[id]/route.ts` — PUT（用户修改）
- Create: `ui/src/app/api/approval/proposals/batch-action/route.ts` — POST（批量审批）
- Modify: `ui/src/lib/query-types.ts` — 添加 ApprovalProposal 类型

- [ ] **Step 1: 添加 TypeScript 类型**

```typescript
// ui/src/lib/query-types.ts 新增
export interface ApprovalProposal {
  proposal_id:      string;
  batch_id:         string;
  source_file_id:   number;
  bank_txn_id:      number;
  brand_code:       string;
  type:             'type1' | 'type2';
  status:           'pending' | 'approved' | 'rejected' | 'modified' | 'executed' | 'timeout';
  llm_lvl1_code:    string | null;
  llm_lvl2_code:    string | null;
  llm_keyword:      string | null;
  llm_match_field:  string | null;
  llm_confidence:   'high' | 'medium' | 'low' | null;
  llm_reasoning:    string | null;
  llm_missing_fields: string[] | null;
  final_lvl1_code:  string | null;
  final_lvl2_code:  string | null;
  final_keyword:    string | null;
  final_match_field:string | null;
  user_note:        string | null;
  resolved_by:      string | null;
  created_at:       string;
  resolved_at:      string | null;
}

export interface ApprovalProposalSubmit {
  source_file_id: number;
  brand:          string;
  records:        ApprovalRecord[];
}

export interface ApprovalRecord {
  bank_txn_id:   number;
  type:          'type1' | 'type2';
  llm_proposal:  {
    lvl1_code:   string;
    lvl2_code:   string;
    keyword:     string;
    match_field: string;
    confidence:  'high' | 'medium' | 'low';
    reasoning:   string;
  } | null;
  missing_fields?: string[];
  reasoning:      string;
}
```

- [ ] **Step 2: 创建 proposals/route.ts**

POST：Agent 提交提案，生成 batch_id，写入 `ops.approval_proposal`
GET：查询提案列表，支持 `?batch_id=` 和 `?brand=` 过滤

```typescript
// POST /api/approval/proposals
// Body: ApprovalProposalSubmit
// Returns: { batch_id: string, count: number, created_at: string }
```

```typescript
// GET /api/approval/proposals
// Query: ?batch_id=&brand=&status=&month=
// Returns: ApprovalProposal[]
```

- [ ] **Step 3: 创建 [id]/route.ts**

PUT：用户修改单条提案（修改 `final_lvl1_code` 等字段），自动设置 `status = 'modified'`

```typescript
// PUT /api/approval/proposals/[id]
// Body: { final_lvl1_code, final_lvl2_code, final_keyword, final_match_field, user_note, resolved_by }
// Returns: ApprovalProposal
```

- [ ] **Step 4: 创建 batch-action/route.ts**

POST：用户批量批准/否决。执行已批准的提案（调用 `settle-batch`），更新状态为 `executed`。

```typescript
// POST /api/approval/proposals/batch-action
// Body: { action: 'approve' | 'reject', proposal_ids: string[], resolved_by: string, brand: string }
// Returns: { executed: number, failed: [], errors: [] }
```

逻辑：
1. 根据 `proposal_ids` 读取提案，校验状态为 `pending`
2. 区分 `approved`（执行 settle-batch）和 `rejected`（只更新状态）
3. 调用 `POST /api/rules/settle-batch` 批量创建规则
4. 更新提案 `status = 'executed'`，`resolved_at = NOW()`
5. 刷新 `bank_txn_classified_snapshot`

- [ ] **Step 5: 类型检查**

Run: `cd ui && npx tsc --noEmit`
Expected: 无编译错误

- [ ] **Step 6: Commit**

```bash
git add ui/src/app/api/approval/ ui/src/lib/query-types.ts
git commit -m "feat(api): add approval proposal CRUD and batch action endpoints"
```

---

## Task 5: 创建审批 UI 页面

**Files:**
- Create: `ui/src/app/u/approvals/page.tsx` — 审批工作台主页面
- Create: `ui/src/app/u/approvals/components/ApprovalRow.tsx` — 单行组件
- Create: `ui/src/app/u/approvals/components/DetailDrawer.tsx` — 详情展开抽屉
- Create: `ui/src/app/u/approvals/components/BatchToolbar.tsx` — 批量操作工具栏

- [ ] **Step 1: 创建主页面 page.tsx**

路由：`/u/approvals`
查询参数：`?batch=`（按 batch_id 过滤）

```typescript
// ui/src/app/u/approvals/page.tsx
// 布局：左侧列表 + 右侧详情抽屉（或全屏列表模式）

// 页面结构：
// 1. Header: 批次信息 + 统计（pending/approved/rejected count）
// 2. Filter bar: 全选 / Type1 / Type2 筛选
// 3. 表格列表: 复选框 | 时间 | 对方 | 摘要 | 金额 | 类型标签 | 操作按钮
// 4. 底部工具栏: 快捷分类下拉 + 批量操作按钮
```

- [ ] **Step 2: 实现 ApprovalRow 组件**

表格行，支持：
- 复选框（用于批量选择）
- 类型标签（Type1: 绿色 "有推荐" / Type2: 黄色 "待补充"）
- 概览：时间 + 对方 + 摘要 + 金额
- 快速预览：LLM 推荐分类（Type1）或缺失字段（Type2）

- [ ] **Step 3: 实现 DetailDrawer 抽屉组件**

点击行展开显示完整详情：
- 完整交易信息（所有字段）
- LLM 推荐方案（Type1）或 信息缺失提示（Type2）
- 用户决策表单：Lvl1/Lvl2 下拉 + 关键词输入 + 匹配字段下拉
- 切换同意/自定义模式
- 单条批准/否决/取消按钮

Lvl1/Lvl2 下拉数据来自：`GET /api/categories` 或已有 category 接口。

- [ ] **Step 4: 实现 BatchToolbar 批量工具栏**

底部固定工具栏：
- 左侧：快捷批量设置（Lvl1/Lvl2/关键词）
- 右侧：批量批准 / 批量否决 / 全部批准 Type1

- [ ] **Step 5: 测试 UI**

Run: `cd ui && npm run dev` → 访问 `/u/approvals?batch=<test-batch-id>`
Expected: 列表正确渲染，选中行展开显示详情

- [ ] **Step 6: Commit**

```bash
git add ui/src/app/u/approvals/
git commit -m "feat(ui): add approval workflow UI page"
```

---

## Task 6: 配置 Agent MCP 连接

**Files:**
- Create: `ui/.mcp.json` — Claude Code Desktop MCP 配置
- Create: `docs/superpowers/plans/2026-05-25-hermes-mcp-setup.md` — Hermes 配置说明

- [ ] **Step 1: 创建 .mcp.json**

```json
// ui/.mcp.json
{
  "mcpServers": {
    "wdg-bank-agent": {
      "url": "http://localhost:4100/api/mcp",
      "description": "WDG bank transaction upload and approval workflow"
    }
  }
}
```

- [ ] **Step 2: 创建 Hermes 配置说明**

```markdown
## Hermes MCP 配置

运行以下命令连接 WDG Bank Agent MCP Server：

```bash
hermes mcp add wdg-bank-agent \
  --url http://localhost:4100/api/mcp \
  --name "WDG 银行流水审批"
```

连接成功后，Agent 可使用以下工具：
- `upload_bank_txn_file` — 上传银行流水文件
- `get_unclassified_transactions` — 读取未匹配记录
- `submit_approval_proposal` — 提交 LLM 分类提案
- `query_approval_status` — 轮询审批结果
```

- [ ] **Step 3: Commit**

```bash
git add ui/.mcp.json docs/superpowers/plans/
git commit -m "docs: add MCP config for Claude Code Desktop and Hermes"
```

---

## Task 7: 集成测试

**Files:**
- Create: `ui/src/app/api/approval/proposals/proposals.test.ts`

- [ ] **Step 1: 编写端到端测试用例**

1. `POST /api/approval/proposals` → 验证 batch_id 生成 + 数据写入
2. `GET /api/approval/proposals?batch_id=X` → 验证过滤
3. `PUT /api/approval/proposals/[id]` → 验证状态更新
4. `POST /api/approval/proposals/batch-action` → 验证批准后 settle-batch 调用

Run: `cd ui && npm run test` (Jest)
Expected: 所有测试通过

- [ ] **Step 2: MCP 工具集成测试**

手动测试 MCP 工具链：
1. `upload_bank_txn_file` → 上传文件
2. `get_unclassified_transactions` → 读取未匹配
3. `submit_approval_proposal` → 提交提案
4. 访问 `/u/approvals` → 审批 UI 正常显示
5. `query_approval_status` → 轮询状态

- [ ] **Step 3: Commit**

```bash
git add ui/src/app/api/approval/proposals/proposals.test.ts
git commit -m "test: add approval API integration tests"
```

---

## 自审清单

- [ ] Spec 中的所有接口都有对应实现
- [ ] Type1/Type2 两种类型都覆盖
- [ ] LLM 推荐字段完整（lvl1/lvl2/keyword/match_field/confidence/reasoning）
- [ ] 信息缺失字段（missing_fields）正确传递
- [ ] 批量执行调用了已有的 settle-batch 接口
- [ ] MCP 工具在 Claude Code Desktop 和 Hermes 上都能连接
- [ ] 审批 UI 支持多选、批量操作、单条详情展开
- [ ] Type1 默认勾选同意，Type2 默认不勾选

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-bank-upload-agent-implementation.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?