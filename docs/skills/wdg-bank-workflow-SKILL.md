---
name: wdg-bank-workflow
description: 当用户提到银行流水上传、分类审批、或需要 Agent 代理处理财务数据时触发。完整覆盖 bank txn 上传 → LLM 推理 → 人工审批 → 执行生效的端到端流程。
---

# WDG 银行流水分类审批工作流

当用户要求上传银行流水、自动分类、或处理未匹配的交易时，加载此技能。

## 系统架构

```
Agent (Claude Code / Hermes / 其他 MCP Client)
  │
  ▼ MCP: upload_bank_txn_file()
  ├───────────────────────────────────► Next.js App (/api/upload)
  │                                     ├── 保存文件到 inputs/
  │                                     └── 触发 import_yufeng_bank_txn.py
  │
  ▼ MCP: get_unclassified_transactions()   读取未匹配记录
  ▼ MCP: get_existing_rules()               获取现有分类规则（供 LLM 参考）
  │
  ├─ LLM 推理 ────────────────────────────── Agent 端执行
  │   ├── Type1: 有推荐方案  → 生成 llm_proposal
  │   └── Type2: 信息缺失  → 生成 missing_fields + reasoning
  │
  ▼ MCP: submit_approval_proposal()         提交到审批队列
  │
  │  用户操作（审批 UI）                     /u/approvals
  │  ├── 批准  → App 自动执行 settle-batch → 写入 bank_rule_map + bank_txn_override
  │  ├── 否决  → 标记为 rejected
  │  └── 修改  → 用户自定义分类 → App 执行
  │
  ▼ MCP: query_approval_status()            轮询审批结果
  │
  ▼ 向用户汇报完成情况
```

## 严禁：禁止直接连接数据库

**禁止行为**：
- 禁止使用 `psql`、`docker exec`、或任何客户端工具直接连接数据库
- 禁止在 Agent 端通过 `ssh` 到服务器执行 SQL 命令
- 禁止读取 `~/.pgpass`、`.env`、或其他配置文件来获取数据库连接字符串
- 禁止通过 Docker 容器内 bash 查询数据

**正确做法**：所有数据查询必须通过 MCP 工具或 HTTP API
- 数据查询 → `get_unclassified_transactions`、`get_transaction_detail`、`get_candidates` 等 MCP 工具
- 数据操作（审批、沉淀规则）→ `submit_approval_proposal` 等 MCP 工具
- 数据库连接字符串等敏感信息仅存在于服务端，Agent 无法直接访问

**为什么**：数据库连接字符串在服务器端环境变量中，Agent 不应尝试绕过 MCP 层直接访问数据。

## MCP 工具清单

所有工具均通过 `POST http://localhost:4100/api/mcp` 调用，JSON-RPC 2.0 格式。

### 0. get_brand_stores（必调）

**用途**: 获取品牌和门店的元数据（code → name 映射）。**每次上传前必调**，用于将 agent 拿到的 `store_code` 翻译成用户可读的名字，在向用户确认时展示。

**参数**:
```json
{
  "brand": "bonjur"   // 可选，不传则返回所有品牌的门店列表
}
```

**返回**:
```json
{
  "brands": [
    {
      "brand_code": "bonjur",
      "brand_name": "Bonjour",
      "stores": [
        { "store_code": "wz_ra", "store_name": "瑞安吾悦广场" },
        { "store_code": "wz_wxc", "store_name": "温州万象城" }
      ]
    }
  ]
}
```

**使用场景**: 
- 上传文件前，先调用此工具了解该品牌有哪些门店
- 上传完成后，拿到 `transactions[].source_file_id` 后，查询该文件对应的门店信息
- 向用户展示时，用 `brand_name` + `store_name` 而非代码

---

### 1. upload_bank_txn_file

**用途**: 上传银行流水 Excel 文件，触发 import pipeline，返回导入结果和覆盖率统计。

**参数**（全部必填）:
```json
{
  "brand": "bonjur",
  "store": "wz_wxc",
  "file_path": "/Users/.../inputs/bonjur/wz_wxc/bank/2026-05/温万202511.xlsx"
}
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `brand` | 品牌代码 | `bonjur`, `yufeng`, `gelatomiiix` |
| `store` | 门店代码 | `wz_wxc`（温州万象城）, `wz_ra`（瑞安吾悦广场） |
| `file_path` | Excel 文件绝对路径 | `/Users/.../温万202511.xlsx` |

**返回**:
```json
{
  "success": true,
  "sourceFileId": 42,
  "rowCount": 156,
  "unclassifiedThisFile": 5,
  "unclassifiedThisBrandMonth": 7,
  "totalThisBrandMonth": 289,
  "coveragePct": 97.58
}
```

**字段说明**:

| 字段 | 含义 |
|------|------|
| `sourceFileId` | 本次上传批次 ID，**后续调用 get_unclassified_transactions 时传入 source_file_id** |
| `rowCount` | 本次上传的总行数 |
| `unclassifiedThisFile` | 本次上传文件中未匹配的行数 |
| `unclassifiedThisBrandMonth` | 该品牌该月所有历史文件中未匹配行数（含历史遗留） |
| `totalThisBrandMonth` | 该品牌该月所有历史文件总行数 |
| `coveragePct` | 品牌+月整体覆盖率 |

**Agent 判断逻辑**:
- `unclassifiedThisFile == 0` → 本次文件全部自动分类完成，流程结束
- `unclassifiedThisFile > 0` → 调用 `get_unclassified_transactions(source_file_id=<sourceFileId>)` 获取具体记录，开始 LLM 推理
- `unclassifiedThisBrandMonth > unclassifiedThisFile` → 有历史遗留，告知用户

**使用场景**: 用户说「上传银行流水」时使用。

---

### 2. get_unclassified_transactions

**用途**: 获取未匹配的银行流水记录（需要 Agent 推理处理的记录）。

**参数**:
```json
{
  "brand": "bonjur",
  "source_file_id": 42,     // 强烈推荐：上传后用 upload 返回的 sourceFileId 精确拉取本次未分类记录
  "month": "2026-05",        // 可选，不传则查品牌全部
  "page": 1,                // 默认1
  "pageSize": 100           // 默认100，最大200
}
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `brand` | 可选 | 默认 `yufeng` |
| `source_file_id` | 强烈推荐 | **上传后用此参数精确获取本次未分类记录**，传入 upload 返回的 `sourceFileId` |
| `month` | 可选 | YYYY-MM 格式 |
| `page` / `pageSize` | 可选 | 分页，默认 1/100 |

**返回**:
```json
{
  "count": 71,
  "transactions": [
    {
      "bank_txn_id": 1234,
      "txn_time": "2026-05-01T10:23:00",
      "counterparty_name": "微信支付",
      "summary": "转账",
      "memo": "",
      "in_amt": 0,
      "out_amt": 0.6,
      "balance_amt": 12345.67,
      "source_file_id": 42,
      "month": "2026-05-01",
      "combined_text": "微信支付 | 转账"
    }
  ],
  "totalPages": 1,
  "page": 1,
  "pageSize": 100,
  "total": 71
}
```

**翻页逻辑**:
- `totalPages > page` → 还有下一页，Agent 应继续翻页获取全部
- 不传 month/source_file_id 时，`total` = 品牌所有未匹配记录总数
- Agent 应循环翻页直到拿到全部，或选择 `pageSize=100` 一次拉完

**使用场景**: 上传后自动调用，获取需要处理的记录列表。

---

### 3. get_existing_rules

**用途**: 获取现有分类规则，供 LLM 推理时参考上下文。

**参数**:
```json
{ "brand": "yufeng" }
```

**返回**: 现有分类规则列表，包含 lvl1/lvl2 分类、匹配字段、关键词。

**使用场景**: 在 LLM 推理前调用，了解已有的分类模式，避免重复提议。

---

### 4. submit_approval_proposal

**用途**: 将 LLM 推理结果作为提案提交到审批队列。

**参数**:
```json
{
  "source_file_id": 42,
  "brand": "yufeng",
  "records": [
    {
      "bank_txn_id": 1234,
      "type": "type1",
      "llm_proposal": {
        "lvl1_code": "REV_BIZ",
        "lvl2_code": "JD",
        "keyword": "退款",
        "match_field": "summary",
        "match_field2": "counterparty_name",
        "match_value2": "京东",
        "confidence": "high",
        "reasoning": "摘要含'退款'且对方含'京东'，只有京东渠道退款才用此组合关键词，其他渠道退款关键字不同。"
      },
      "reasoning": "规则匹配：summary 含'退款' AND counterparty_name 含'京东'"
    },
    {
      "bank_txn_id": 1235,
      "type": "type2",
      "llm_proposal": null,
      "missing_fields": ["counterparty_name"],
      "reasoning": "对方名称为空，摘要仅'转账'，无任何语义线索，无法推断分类。"
    }
  ]
}
```

**借贷方向强制判定**:

LLM 推理时，**必须优先根据借贷方向判断一级分类**：

| 条件 | 强制规则 |
|------|---------|
| `in_amt > 0`（钱进来） | 只能分配到 **收入类** 一级分类（REV_BIZ、REV_OTHER） |
| `out_amt > 0`（钱出去） | 只能分配到 **支出类** 一级分类（EXP_OTHER、BUILD、HR、MATERIAL、MKT、RENT_UTIL、SHIP、TAX_SURCHARGE、ADMIN 等） |

**常见误判场景（必须避免）**：

| 摘要关键词 | 误判结果 | 正确判定（钱进来时） | 原因 |
|-----------|---------|-------------------|------|
| 退押金、退租金、退货款 | → RENT_UTIL/支出 | → REV_OTHER/退款 | "退"=还回来，钱进来 |
| 退款、退费、退余款 | → MKT/支出 | → REV_OTHER/退款 | "退"=还回来，钱进来 |
| 退款 | → EXP_OTHER | → REV_BIZ/JD等 | 钱进来，只能是收入 |
| 补贴、奖励、返现 | → ADMIN/支出 | → REV_OTHER/补贴收入 | 钱进来 |
| 报销返还 | → ADMIN | → REV_OTHER/报销返还 | 钱进来 |

**推理 prompt 补充（Agent 内部执行时使用）**:
```
在分类前，先看金额方向：
- in_amt > 0 → 这条是收入，一级分类必须是 REV_BIZ 或 REV_OTHER
- out_amt > 0 → 这条是支出，一级分类绝对不能是 REV_* 开头

常见错误：把"退押金"、"退款"、"补贴"归到支出类，是因为只看文字没看金额方向。
带"退"、"返还"、"补贴"、"奖励"字样的，通常是 in_amt > 0。
```

**何时使用 AND 双条件**:

当单个关键词会在多个渠道/场景中产生歧义时，使用 AND 双条件消歧：

| 场景 | 单条件歧义 | AND 解法 |
|------|-----------|---------|
| "退款"在多个渠道出现 | 美团/饿了么/京东都有退款 | summary 含"退款" AND counterparty_name 含"京东" |
| "转账"仅作中转 | 需配合对方名称判断实际用途 | summary 含"转账" AND counterparty_name 含"林建云" |
| "工资"有不同主体 | 老板注资 vs 工资发放 | summary 含"工资" AND counterparty_name 含"劳务" |

**返回**:
```json
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "count": 2,
  "created_at": "2026-05-25T15:30:00Z",
  "detail_url": "http://localhost:4100/u/approvals?batch=550e8400-e29b-41d4-a716-446655440000"
}
```

**Type1 vs Type2 判定规则**:

| 情况 | Type | 说明 |
|------|------|------|
| LLM 能推断出分类 | type1 | 提供 llm_proposal |
| 对方名称或摘要为空 | type2 | missing_fields: ["counterparty_name"] |
| 金额异常大且无法判断 | type2 | missing_fields: ["上下文"] |
| 摘要模糊（如仅"转账"） | type2 | missing_fields: ["counterparty_name", "summary"] |

**使用场景**: LLM 推理完成后，批量提交所有提案。

---

### 5. query_approval_status

**用途**: 轮询审批状态，直到用户完成审批。

**参数**:
```json
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "brand": "yufeng"
}
```

**返回**:
```json
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "total": 23,
  "pending": 12,
  "approved": 8,
  "rejected": 2,
  "modified": 1,
  "detail_url": "http://localhost:4100/u/approvals?batch=550e8400-e29b-41d4-a716-446655440000"
}
```

**轮询策略**:
1. 提交提案后，等待 30 秒
2. 每 60 秒轮询一次
3. 如果 `pending == 0`，说明用户已处理完所有提案
4. 如果超过 10 分钟仍有很多 pending，主动通知用户

**使用场景**: 提交提案后，等待用户审批结果。

---

### 6. get_transaction_detail（辅助）

**用途**: 获取单条交易的详细信息和关键词候选。

**参数**:
```json
{ "bank_txn_id": 1234 }
```

---

### 7. get_candidates（辅助）

**用途**: 获取某条交易的关键词候选，用于 LLM 推理时的参考。

**参数**:
```json
{ "bank_txn_id": 1234 }
```

---

## 完整工作流示例

```
用户: "帮我上传这个月的银行流水"
Agent:
  1. 调用 get_brand_stores({"brand": "bonjur"})
     → 返回品牌名 "Bonjour" 和门店列表: wz_ra=瑞安吾悦广场, wz_wxc=温州万象城

  2. 向用户确认:
     "Bonjour 品牌有以下门店：
      - 瑞安吾悦广场 (wz_ra)
      - 温州万象城 (wz_wxc)
      请告诉我要上传哪个门店的银行流水文件，以及文件路径。"

  [用户回复: "上传瑞安吾悦广场的 /path/to/may.xlsx"]

  3. 调用 upload_bank_txn_file({"brand": "bonjur", "store": "wz_ra", "file_path": "/path/to/may.xlsx"})
     → 返回 {"sourceFileId": 42, "rowCount": 156, "unclassifiedThisFile": 0, "unclassifiedThisBrandMonth": 2, "totalThisBrandMonth": 289, "coveragePct": 99.31}

  4. 分析覆盖率:
     - unclassifiedThisFile=0 → 本次文件全部自动分类完成
     - unclassifiedThisBrandMonth=2 → 品牌+月整体有2条历史未匹配（来自 source_file_id=19）
     → 告知用户："本次上传156条已全部分类。Bonjour 品牌2026-05月还有2条未匹配记录来自之前上传的文件，是否需要处理？"
     → 如果用户同意，调用 get_unclassified_transactions({"brand": "bonjur", "month": "2026-05", "pageSize": 100})
        - total=2, totalPages=1 → 一次拿完，无需翻页

  4a. 如果 unclassifiedThisFile > 0（本次有未分类）:
     → 调用 get_unclassified_transactions({"brand": "bonjur", "source_file_id": 42})
        - 用 upload 返回的 sourceFileId 作为 source_file_id 参数，精确获取本次上传的未分类记录
        - total = unclassifiedThisFile 数字对齐

  5. 调用 get_existing_rules({"brand": "bonjur"})
     → 返回现有分类规则列表

  6. LLM 推理:
     - 对每条记录判断: Type1（有推荐）还是 Type2（信息缺失）
     - Type1 生成: lvl1_code, lvl2_code, keyword, match_field, match_field2?, match_value2?, confidence, reasoning
     - Type2 生成: missing_fields, reasoning
     - 遇到歧义关键词时优先使用 AND 双条件（见上方说明）

  7. 调用 submit_approval_proposal({...})
     → 返回 {"batch_id": "xxx", "count": N}

  8. 通知用户:
     "已为【Bonjour · 瑞安吾悦广场】上传 156 条银行流水，本次文件覆盖率 100%。
      品牌+月整体覆盖率 99.31%（289条中2条未匹配，来自历史上传）。
      LLM 分析这 2 条历史遗留记录:
      - 2 条有推荐分类方案（Type1）
      请打开审批页面查看: http://localhost:4100/u/approvals?batch=xxx"

  9. 轮询 query_approval_status，直到 pending == 0

  10. 汇报结果:
      "审批完成！
       - 批准: 18 条（已生成分类规则）
       - 否决: 2 条
       - 修改后批准: 3 条
       本批次覆盖率从 87% 提升到 98%。"
```

## 与 OpenClaw 的协作

如果通过 OpenClaw（WhatsApp/Signal）触发工作流：

1. OpenClaw 接收用户消息（如「上传银行流水」）
2. OpenClaw 将指令转发给 Agent
3. Agent 执行工作流，在关键节点通过 OpenClaw 通知用户
4. 用户通过 OpenClaw 收到的链接打开审批页面

```
OpenClaw 通知用户:
"📊 银行流水已上传（156 条）
 🏷️ 23 条需要审批
 👉 点击审批: http://localhost:4100/u/approvals?batch=xxx
 ⏰ 请在 24 小时内处理"
```

## LLM 推理指南

### 分类代码参考

从 `get_existing_rules()` 获取现有规则，主要分类：

- **FEE**: 费用类（手续费、服务费）
- **INCOME**: 收入类
- **ASSET**: 资产类
- **PAYMENT**: 支出/付款类

### Type1 推荐生成规则

LLM 推荐时参考以下因素：

1. **counterparty_name** 包含品牌词 → 高置信度
   - "微信支付" → FEE › 微信手续费
   - "支付宝" → FEE › 支付宝服务费
   - "美团" → FEE › 美团服务费

2. **金额特征** → 辅助判断
   - 极小金额（<10元）+ 品牌名 → 手续费
   - 固定金额（每月相同）→ 订阅费/服务费
   - 大额整数 → 可能涉及货款/投资

3. **摘要关键词**
   - "工资" → INCOME › 工资
   - "退款" → INCOME › 退款
   - "转账" → 需要配合 counterparty 判断

### Type2 判定规则

以下情况判定为 Type2（信息缺失）：

- `counterparty_name` 为空
- `counterparty_name` 和 `summary` 均为通用词（"转账"、"汇款"）
- 金额异常大（>10万）且无品牌线索
- 涉及投资/理财无法判断用途

## MCP 连接方式

### Claude Code Desktop
编辑 `ui/.mcp.json` 或 `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "wdg-bank-agent": {
      "url": "http://localhost:4100/api/mcp"
    }
  }
}
```
重启 Claude Code Desktop 后自动加载工具。

### Hermes
```bash
hermes mcp add wdg-bank-agent \
  --url http://localhost:4100/api/mcp \
  --name "WDG 银行流水审批"
```

### 测试 MCP 连接
```bash
# 查看工具列表
curl -X POST http://localhost:4100/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 调用工具
curl -X POST http://localhost:4100/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_unclassified_transactions","arguments":{"brand":"yufeng","month":"2026-05"}}}'
```

## 审批页面说明

用户打开 `http://localhost:4100/u/approvals?batch=<batch_id>` 后：

- **Type1（有推荐）**: 默认勾选同意 LLM 推荐，用户可直接批量批准
- **Type2（待补充）**: 默认不勾选，用户需手动选择分类
- **快捷操作**: 底部分类下拉可批量设置选中行的分类
- **单条修改**: 点击任意行展开详情，可单独批准/否决/修改

## 数据库表

`ops.approval_proposal` — 存储所有审批提案，状态流转：

```
pending → approved → executed（执行 settle-batch）
       → rejected
       → modified → executed
       → timeout（24小时未处理）
```