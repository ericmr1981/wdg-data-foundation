# 银行流水 Agent 上传与审批系统设计

**日期**: 2026-05-25
**状态**: 设计中

---

## 1. 背景与目标

为各类 AI Agent（Claude Code Desktop / Hermes / OpenClaw / Cline / Cursor 等）提供银行流水上传 + 智能分类审批的完整工具链。Agent 作为用户的代理完成银行流水的全流程处理：上传 → 自动匹配 → LLM 推理 → 人工审批 → 执行生效。

---

## 2. 角色分工

| 角色 | 职责 |
|------|------|
| **Agent** | 上传文件、读取未匹配记录、LLM 推理生成提案、提交提案、轮询审批结果 |
| **App（Next.js）** | 执行 import pipeline、存储提案、渲染审批 UI、执行 settle-batch |
| **用户** | 在审批 UI 中查看提案、批量批准/否决/修改 |

---

## 3. 技术架构

### 3.1 MCP Server（Next.js 内嵌）

**端口**: 4100（与 Next.js 共用）

**工具列表**:

| 工具名 | 参数 | 返回 | 说明 |
|--------|------|------|------|
| `upload_bank_txn_file` | `brand`, `store`, `file_path` | `{ file_id, row_count, status }` | 上传文件并触发 import pipeline |
| `get_unclassified_transactions` | `brand`, `month?` | `Transaction[]` | 读取未匹配的银行流水 |
| `get_transaction_detail` | `bank_txn_id` | `TransactionDetail` | 读取单条记录完整信息 |
| `get_candidates` | `bank_txn_id` | `Candidate[]` | 获取关键词候选（已有逻辑） |
| `get_existing_rules` | `brand` | `Rule[]` | 读取现有分类规则（供 LLM 参考） |
| `submit_approval_proposal` | `proposals[]` | `{ proposal_batch_id, count }` | Agent 提交 LLM 推理后的提案 |
| `query_approval_status` | `proposal_batch_id` | `{ status, approved[], rejected[], pending[] }` | 轮询审批状态 |

**MCP 连接方式**: HTTP 传输，路由 `/api/mcp`

### 3.2 提案数据格式

Agent → App 提交的提案 payload：

```json
{
  "source_file_id": 42,
  "records": [
    {
      "bank_txn_id": 123,
      "type": "type1",
      "llm_proposal": {
        "lvl1_code": "FEE",
        "lvl2_code": "WECHAT_FEE",
        "keyword": "微信支付",
        "match_field": "counterparty_name",
        "confidence": "high",
        "reasoning": "对方名称含'微信支付'，金额极小，符合微信手续费特征"
      }
    },
    {
      "bank_txn_id": 456,
      "type": "type2",
      "llm_proposal": null,
      "missing_fields": ["counterparty_name"],
      "reasoning": "对方名称为空，摘要仅'转账'，无法推断任何语义"
    }
  ]
}
```

Type 1: LLM 有推荐方案
Type 2: 信息缺失，无法推荐

### 3.3 数据库新表

**`ops.approval_proposal`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `proposal_id` | UUID | PK |
| `batch_id` | UUID | 同一批提交的 batch |
| `source_file_id` | INT | FK → `raw.ingest_file` |
| `bank_txn_id` | BIGINT | FK → bank_txn |
| `type` | TEXT | `'type1'` 或 `'type2'` |
| `status` | TEXT | `pending` / `approved` / `rejected` / `modified` |
| `llm_lvl1_code` | TEXT | LLM 推荐 lvl1 |
| `llm_lvl2_code` | TEXT | LLM 推荐 lvl2 |
| `llm_keyword` | TEXT | LLM 推荐关键词 |
| `llm_match_field` | TEXT | LLM 推荐匹配字段 |
| `llm_confidence` | TEXT | `high` / `medium` / `low` |
| `llm_reasoning` | TEXT | LLM 推理理由 |
| `llm_missing_fields` | TEXT[] | 信息缺失字段（type2） |
| `final_lvl1_code` | TEXT | 用户最终选择 |
| `final_lvl2_code` | TEXT | 用户最终选择 |
| `final_keyword` | TEXT | 用户最终关键词 |
| `final_match_field` | TEXT | 用户最终字段 |
| `user_note` | TEXT | 用户备注 |
| `resolved_by` | TEXT | 用户 ID |
| `created_at` | TIMESTAMPTZ | 提案创建时间 |
| `resolved_at` | TIMESTAMPTZ | 审批时间 |

---

## 4. 审批 UI 设计

**路由**: `/u/approvals`

### 4.1 列表视图

```
┌─ 待审批 (3) ───────────────────────────────────────────────┐
│  全选 ☑  筛选: ○全部  ○Type1有推荐  ○Type2待补充          │
│  ┌──┬────────┬────────┬────────┬────────┬────────────────┐│
│  │☑ │ 时间    │ 对方    │ 摘要   │ 金额    │ 分类方案         ││
│  ├──┼────────┼────────┼────────┼────────┼────────────────┤│
│  │☑ │ 05-01  │微信支付  │转账    │ -0.60  │ 费用›微信手续费 ✓│
│  │☑ │ 05-03  │ —       │转账    │ -5000  │ ⚠️ 待补充        ││
│  │☐ │ 05-05  │支付宝    │转账    │ -12.50 │ 费用›支付宝服务费 ││
│  └──┴────────┴────────┴────────┴────────┴────────────────┘│
│  快捷批量: Lvl1[费用      ▼] Lvl2[服务费    ▼] 关键词[    ] │
│  [☑ 同意选中的推荐] [✏️ 覆盖为快捷选择] [批准选中的] [否决选中的] │
└───────────────────────────────────────────────────────────┘
```

### 4.2 详情展开

点击一行展开：

```
┌─ 交易详情 ────────────────────────────────────────────────┐
│  对方: 微信支付  │  时间: 2026-05-01 10:23               │
│  摘要: 转账      │  用途: —  │  余额: 12,345.67           │
│  金额: -0.60 (支出)                                     │
│                                                        │
│  ── LLM 推荐方案 ──                                      │
│  分类: 费用 › 微信手续费                                 │
│  关键词: "微信支付"  (匹配字段: counterparty_name)        │
│  置信度: 高                                              │
│  理由: 对方名称含'微信支付'，金额极小，符合微信手续费特征  │
│                                                        │
│  ── 用户决策 ──                                          │
│  Lvl1: [费用         ▼]  Lvl2: [微信手续费  ▼]          │
│  关键词: [微信支付  ]   匹配字段: [counterparty_name ▼]  │
│  ☐ 同意 LLM 推荐  ☑ 自定义选择                           │
│                                                        │
│  [批准此条] [否决此条] [取消]                             │
└────────────────────────────────────────────────────────┘
```

Type 2 展开时，LLM 推荐方案区域显示：

```
┌─ ⚠️ 信息不足，无法自动推荐 ───────────────────────────────┐
│  缺失字段: 对方名称                                        │
│  LLM 判断: 摘要为"转账"，无其他上下文，无法推断语义       │
│  建议: 请结合银行流水截图或原始凭证判断                   │
└─────────────────────────────────────────────────────────┘
```

### 4.3 批量操作

- **底部快捷栏**: 选择 Lvl1/Lvl2/关键词 → 批量覆盖选中行的决策
- **单行操作**: 点击行末 [同意] [修改] [否决] 按钮
- **全选/多选**: 复选框支持 Shift 多选

---

## 5. 执行流程

### 5.1 完整时序

```
Agent                          App                          用户
 ────                          ────                          ────
  │                             │                             │
  │ upload_bank_txn_file()      │                             │
  ├────────────────────────────►│ 保存文件 + triggerImport    │
  │                             │                             │
  │ get_unclassified_txns()     │                             │
  ├────────────────────────────►│                             │
  │◄────────────────────────────┤ 未匹配记录列表              │
  │                             │                             │
  │ get_existing_rules()        │                             │
  ├────────────────────────────►│                             │
  │◄────────────────────────────┤ 现有分类规则                │
  │                             │                             │
  │ [LLM 推理 → 分类提案]        │                             │
  │  Type1: 有推荐              │                             │
  │  Type2: 信息缺失            │                             │
  │                             │                             │
  │ submit_approval_proposal()  │                             │
  ├────────────────────────────►│ 存储到 approval_proposal   │
  │                             │                             │
  │                             ├────────────────────────────►│ 查看审批页面
  │                             │◄────────────────────────────┤ 批准/否决/修改
  │                             │                             │
  │                             │ settle-batch (已批准的)      │
  │                             │ refresh_snapshot            │
  │                             │                             │
  │ query_approval_status()      │                             │
  ├────────────────────────────►│                             │
  │◄────────────────────────────┤ 审批结果                    │
  │                             │                             │
  │ [向用户汇报完成情况]         │                             │
```

### 5.2 审批结果处理（App 自动执行）

用户批准后，App 执行：

1. 读取所有 `status = approved` 的提案
2. 按 `source_file_id` 分组
3. 调用 `POST /api/rules/settle-batch`（复用已有接口）
4. 更新 `proposal.status = 'approved'`，写入 `resolved_at`
5. 刷新 `bank_txn_classified_snapshot`

### 5.3 轮询策略

Agent 轮询审批状态：
- 首次查询: 提交后 30 秒
- 后续: 每 60 秒一次
- 超时: 24 小时后标记为 `timeout`
- 通知: 通过 OpenClaw（WhatsApp/Signal）通知用户有新的待审批提案

---

## 6. Agent 支持矩阵

| Agent | 连接方式 | MCP Client | MCP Server | 通知 |
|-------|---------|-----------|------------|------|
| Claude Code Desktop | `.mcp.json` | ✅ | ❌ | ❌ |
| Hermes | `hermes mcp add --url http://localhost:4100/api/mcp` | ✅ | ❌ | ❌ |
| OpenClaw | REST API 脚本（内置工具） | ❌ | ❌ | ✅ WhatsApp/Signal/Telegram |
| Cline | `.mcp.json` 或 `cline_mcp.json` | ✅ | ❌ | ❌ |
| Cursor | `.cursor/mcp.json` | ✅ | ❌ | ❌ |

**OpenClaw 角色**: 纯通知层，不执行 MCP 逻辑。Agent 提交提案后，OpenClaw 通过消息渠道通知用户有新的待审批项，轮询审批状态后向用户报告结果。

---

## 7. 关键约束

- **App 不做推理**: 审批 UI 只渲染 Agent 提交的提案，不做任何 LLM 判断
- **幂等上传**: 文件通过 SHA-256 hash 实现幂等，重复上传不会重复插入
- **提案一次性**: 同一批提案提交后不可修改，只能在 UI 上做审批决策
- **Agent 自主轮询**: Agent 负责轮询审批状态，App 不主动推送给 Agent
- **Type1 预设同意**: Type1（LLM 有推荐）默认勾选同意，用户可直接批量批准
- **Type2 预设待填**: Type2（信息缺失）默认不勾选，引导用户补充判断

---

## 8. 现有接口复用

| 已有接口 | 用途 |
|---------|------|
| `POST /api/upload` | Agent 上传文件（已支持） |
| `GET /api/match` | 读取未匹配记录 |
| `GET /api/match/candidates` | 关键词候选 |
| `GET /api/rules` | 读取现有规则 |
| `GET /api/coverage/by-file` | 覆盖率查询 |
| `POST /api/rules/settle-batch` | 批量创建规则（审批执行复用） |

---

## 9. 新增接口清单

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/approval/proposals` | POST | Agent 提交提案 |
| `/api/approval/proposals` | GET | 按 batch_id 查询提案 |
| `/api/approval/proposals/batch-action` | POST | 用户批量批准/否决 |
| `/api/approval/proposals/{id}` | PUT | 用户修改单个提案 |
| `/api/mcp` | POST | MCP 协议入口 |

---

## 10. 下一步

- [ ] 编写实现计划
- [ ] 实现 MCP Server 路由
- [ ] 实现 approval 相关 API
- [ ] 实现审批 UI 页面
- [ ] 配置各 Agent 的 MCP 连接