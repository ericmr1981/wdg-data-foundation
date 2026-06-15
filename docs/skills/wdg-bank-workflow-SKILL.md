---
name: wdg-data-platform
description: 当用户提到 WDG 数据平台 / 蜜可诗 / Bonjour / 泰柯茶园 三个品牌任一的「银行流水上传、分类审批、企迈(起麦)数据导入查询、门店月报、财务报表（利润表/现金流量表/资产负债表）、销售分析（Gelatomiiix / Bonjur）、Tamkoko 库存入账」时触发。覆盖 45 个 MCP 工具的端到端 Agent 工作流：读路径全开、写路径仅限 submit_proposal / rerun_match_by_file / upload_*，规则 CRUD 与审批决策由人工在 UI 完成。
---

# WDG 数据平台 Agent 工作流

> 当用户要求处理 WDG（蜜可诗 / Bonjour / 泰柯茶园）旗下任一品牌的数据时，加载此技能。涵盖 45 个 MCP 工具（[docs/mcp-tools.md](../../docs/mcp-tools.md) 是完整工具参考；本技能说明 Agent 视角的关键链路与原则）。

## 1. 品牌与门店（必读 — 数据使用前提）

3 个真实品牌 + 7 家门店（[CLAUDE.md](../../CLAUDE.md) 详）：

| brand_code | display | schema_prefix | stores |
|---|---|---|---|
| `gelatomiiix` | 蜜可诗 | `brand_gelatomiiix` | sh_sc, sh_xtd |
| `bonjur` | Bonjour / 旺鼎阁 | `bonjur` | sh_wdg, wz_ra, wz_wxc |
| `tamkoko` | 泰柯茶园 | `brand_tamkoko` | hz_fuyang, wz_bjwxc |

**`xintiandi` 不是品牌**：是 admin/brands 创建新品牌的 delivery 模板 schema（[sql/xintiandi/](../../sql/xintiandi/)，DB 中未部署）。**不要假设 xintiandi 是一个可查询的品牌**。

**门店代码 vs 品牌代码**：API 接受 `brand`（必填 / 限定范围）和 `store_code`（具体门店，gelatomiiix/bonjur 销售查询用）。多数财务/store-report API 用 `store` 形参默认 `all`。

## 2. Agent 写权限原则（最重要）

> **Agent 只能生成提案。规则 CRUD、审批决策、cfg 变更由人工在 UI 完成。**

| 写操作 | Agent 可调？ | 说明 |
|---|---|---|
| 上传文件（银行 / 企迈 / 库存） | ✅ | `upload_bank_txn_file` / `upload_gelatomiiix_income_detail` / `upload_bonjur_income_detail` / `upload_bonjur_product_sales` / `upload_bonjur_sales_self_service` / `upload_tamkoko_inventory` |
| 写规则提案 | ✅ | `submit_proposal`（写到 approval 队列） |
| 重跑分类（刷新 snapshot） | ✅ | `rerun_match_by_file`（按 source_file_id 列表或 all_files） |
| 创建 / 更新 / 删除规则 | ❌ NO | 人工在 `/rules` 页面 settle 审批通过的提案 |
| 批准 / 否决提案 | ❌ NO | 人工在 `/u/approvals` 页面 |
| 导入 / 回滚 / 重新排序规则 | ❌ NO | 人工在 UI |
| 任何 cfg 变更 | ❌ NO | 人工 |

**工作流**：
1. Agent 上传文件 → 拿到 `sourceFileId`
2. Agent 找未分类 → 调 `get_unclassified_transactions` / `get_unclassified_by_file`
3. Agent 检查单条 → `get_txn_detail` / `get_candidates` / `get_rules` / `preview_match`
4. Agent 查 lvl1/lvl2 字典 → `list_categories`
5. Agent **提案** → `submit_proposal`（带 LLM 推理）
6. **人工**审 → 触发 settle 落定到 `bank_rule_map`
7. Agent 触发重跑 → `rerun_match_by_file` 让新规则生效到历史数据
8. 验证覆盖率 → `get_coverage_by_file` / `get_pipeline_kpi`

## 3. 严禁：禁止直接连接数据库

**禁止**：
- ❌ `psql` / `docker exec` / 任何客户端直连 DB
- ❌ 通过 `ssh` 上服务器跑 SQL
- ❌ 读取 `~/.pgpass` / `.env` / 任何配置文件拿连接串
- ❌ 在 Docker 容器内 bash 查询

**正确做法**：所有数据访问走 MCP 工具或 HTTP API。
- 查询 → `get_*` / `query_*` MCP 工具
- 导入 → `upload_*` MCP 工具
- 分析 → `get_qimai_entry_rate` / `query_financial_*` / `query_store_report_*`

**为什么**：DB 连接串在服务端环境变量，Agent 绕开 MCP 会破坏审计 + 数据一致性。

## 4. 工具按模块速查

完整 45 工具 → [docs/mcp-tools.md](../../docs/mcp-tools.md)。下面是按"Agent 任务"组织的速查：

### 4.1 数据健康检查
| 任务 | 工具 |
|---|---|
| 查 brand/store 名称 | `get_brand_stores` |
| 品牌+月整体覆盖 | `get_pipeline_kpi` |
| 按文件查覆盖 | `get_coverage_by_file` |
| 取分类字典 | `list_categories` |
| 取规则分组 | `list_rule_groups` |

### 4.2 银行流水（11 件 — Agent 主链路）
**上传 → 查未分类 → 查单条 → 查候选 → 查规则 → 预览 → 提案 → 查审批 → 查历史**
- `upload_bank_txn_file` — 上传 Excel，返回 sourceFileId + 覆盖率
- `get_unclassified_transactions` — 全局未分类列表（带 `source_file_id` 过滤推荐）
- `get_unclassified_by_file` — 按文件粒度的未分类（更细）
- `get_txn_detail` — 单条详情（counterparty/summary/memo/purpose）
- `get_candidates` — 推荐 match_value 关键词
- `get_rules` — 现有规则
- `preview_match` — 候选关键词命中预估
- `submit_proposal` — **写提案**（LLM 推理 → 审批队列）
- `get_proposal` — 单条提案详情
- `query_approval_status` — 提案状态统计
- `rerun_match_by_file` — 规则改完重跑 snapshot
- `get_rules_history` — 规则变更历史（审计）

### 4.3 财务报表（7 件 — 财务分析）
| 任务 | 工具 |
|---|---|
| 利润表 / 现金流量表 / 资产负债表 | `query_financial_statement` (3-in-1) |
| Dashboard 概览 | `query_financial_overview` |
| KPI 趋势图 | `query_financial_kpi_trend` |
| 交易对手 | `query_counterparty`（in / out 方向）|
| 收入侧 metrics | `query_income_metrics` |
| 支出侧 metrics | `query_payment_metrics` |
| 起麦对账 | `query_qimai_revenue`（gross / net / refund）|

**公共参数**：`brand` (gelatomiiix|bonjur|tamkoko)、`period` (YYYY-MM)、`span` (month|quarter|year)、`store` (默认 `all`)

### 4.4 门店月报（2 件）
- `query_store_report_snapshot` — 单店 × 月快照（含上月对比）
- `query_store_report_trend` — 1-24 月趋势

**返回字段**：revenue / cost / expense / hr / rent / gross_profit / net_profit / operating_cf / cash_balance / loan_balance + 比率（gross_profit_rate_pct / net_profit_rate_pct / hr_ratio_pct / rent_ratio_pct / cashflow_runway_months）

### 4.5 收入 / 企迈（4 件）
- `upload_gelatomiiix_income_detail` — 上传 Qimai 收入 CSV → `gelatomiiix_ods.income_detail`
- `upload_bonjur_income_detail` — 上传 → `bonjur_ods.income_detail`
- `query_gelatomiiix_income` — 查询（支持 `month` 或 `date_from/date_to`、`channel` 过滤、`summary_only` 聚合模式）
- `get_qimai_entry_rate` — **Gelatomiiix-only** 起麦 vs 银行入账率分析

### 4.6 销售（11 件 — 7 + 4）
**Gelatomiiix 7 件**（`store_code` + `month`，支持 `pure_mode` 净销售过滤）：
- `query_gelatomiiix_sales_overview` — 月度 KPI
- `query_gelatomiiix_sales_trend` — 12 月趋势
- `query_gelatomiiix_sales_channels` — 渠道拆分
- `query_gelatomiiix_sales_products` — SKU 排行
- `query_gelatomiiix_sales_details` — 交易明细（type: cash_register | qimai, paginated）
- `query_gelatomiiix_sales_distribution` — 分布
- `query_gelatomiiix_sales_hourly` — 时段分布

**Bonjur 4 件**（已有 `query_bonjur_qimai_sales` + `query_bonjur_sales_summary`）：
- `query_bonjur_sales_summary` — 3-in-1: overview / trend / channels
- `query_bonjur_sales_products` — SKU
- `query_bonjur_sales_details` — 明细
- `query_bonjur_qimai_sales` — Qimai POS 渠道明细

### 4.7 Tamkoko 库存（1 件）
- `upload_tamkoko_inventory` — 上传 .xlsx → `brand_tamkoko_ods.inventory_month_end`

### 4.8 永久跳过的工具（Agent 不要尝试）
| 工具 / 端点 | 原因 |
|---|---|
| `xintiandi` 任何工具 | schema 未部署，调用 500 |
| `export_rules` 等 xlsx 端点 | `xlsx` 包未装，编译失败 |
| `/api/rules` (POST/PUT/DELETE) | Agent 写权限（人类 settle）|
| `/api/rules/settle` / `settle-batch` | 同上 |
| `/api/approval/proposals/[id]` (PUT) | 人类审批 |
| `/api/approval/proposals/batch-action` | 人类 |
| `/api/rules/import` / `rollback` / `reorder` | 人类 |

## 5. 必调的前置工具：`get_brand_stores`

**任何上传/查询前必调**，把 `brand_code` / `store_code` 翻译成人类可读名字再向用户确认。

```json
{ "brand": "bonjur" }  // 不传则返回所有
```

返回：
```json
{
  "brands": [{
    "brand_code": "bonjur",
    "brand_name": "Bonjour",
    "stores": [
      { "store_code": "wz_ra", "store_name": "瑞安吾悦广场" },
      { "store_code": "wz_wxc", "store_name": "温州万象城" }
    ]
  }]
}
```

## 6. 关键工作流示例

### 6.1 银行流水上传 + 分类审批（核心链路）

```
用户: "上传瑞安吾悦广场 5 月银行流水 /path/to/温万202511.xlsx"

Agent:
  1. get_brand_stores({brand:"bonjur"})
     → wz_ra=瑞安吾悦广场, wz_wxc=温州万象城
  2. 向用户确认: "Bonjour 旗下 wz_ra=瑞安吾悦广场，5 月流水？"
  3. upload_bank_txn_file({brand:"bonjur", store:"wz_ra", file_path:"/path/to/温万202511.xlsx"})
     → { sourceFileId: 42, rowCount: 156, unclassifiedThisFile: 5, coveragePct: 97.58 }
  4. get_unclassified_transactions({brand:"bonjur", source_file_id:42})
     → 5 条未分类 txn 详情
  5. get_existing_rules({brand:"bonjur"}) + get_txn_detail + get_candidates + preview_match
     → LLM 推理依据
  6. list_categories({brand:"bonjur"})
     → 拿 lvl1/lvl2 字典
  7. LLM 推理（见下方 §7 借贷方向强制规则）
  8. submit_proposal({...})
     → { batch_id: "xxx", count: 5 }
  9. 通知用户: "5 条未分类已提案，请打开 /u/approvals?batch=xxx 审批"
  10. 轮询 query_approval_status({batch_id:"xxx"})，直到 pending==0
```

### 6.2 财务报表查询

```
用户: "Bonjur 2026 Q1 利润表"

Agent:
  1. query_financial_statement({
       statement: "profit",
       brand: "bonjur",
       period: "2026-01",  // Q1 起点
       span: "quarter"      // 自动展开为 2026-01/02/03
     })
  2. 解读并展示给用户
```

### 6.3 门店月报

```
用户: "蜜可诗上海新天地店 2026-04 月报"

Agent:
  1. get_brand_stores({brand:"gelatomiiix"})
     → sh_xtd=上海新天地店
  2. query_store_report_snapshot({brand:"gelatomiiix", store:"sh_xtd", month:"2026-04"})
     → { current: { revenue_amt, cost_amt, gross_profit_amt, ... }, previous: {...} }
  3. 可选：query_store_report_trend({brand:"gelatomiiix", store:"sh_xtd", months:12})
     → 12 月趋势数组
```

### 6.4 销售分析（Gelatomiiix）

```
用户: "蜜可诗上海新天地店 4 月销售概览 + 渠道分布"

Agent:
  1. query_gelatomiiix_sales_overview({store_code:"sh_xtd", month:"2026-04"})
  2. query_gelatomiiix_sales_channels({store_code:"sh_xtd", month:"2026-04"})
  3. 整合展示（KPI + 渠道占比）
```

### 6.5 企迈入账率（Gelatomiiix）

```
用户: "蜜可诗 4 月份企迈入账率怎么样"

Agent:
  1. get_qimai_entry_rate({period:"2026-04"})
     → { channel_metrics: [...], monthly_trend: [...], unmatched_orders: [...] }
  2. 解读：低入账率渠道 + 未入账订单数
```

## 7. 银行流水分类 — 借贷方向强制判定（银行链路必读）

LLM 推理时**必须**先看金额方向再选一级分类：

| 条件 | 强制规则 |
|---|---|
| `in_amt > 0`（钱进来） | 只能 REV_BIZ / REV_OTHER（收入类）|
| `out_amt > 0`（钱出去） | 只能 EXP_*（HR / MATERIAL / MKT / RENT_UTIL / SHIP / TAX_SURCHARGE / ADMIN / BUILD 等）|

**常见误判**（钱进来看"退"字就当支出 — 错）：

| 摘要 | 误判 | 正确（in_amt > 0 时）|
|---|---|---|
| 退押金 / 退租金 / 退货款 | RENT_UTIL/支出 | REV_OTHER/退款 |
| 退款 / 退费 | MKT/支出 | REV_BIZ 或 REV_OTHER |
| 补贴 / 奖励 / 返现 | ADMIN/支出 | REV_OTHER/补贴 |
| 报销返还 | ADMIN | REV_OTHER/报销返还 |

**AND 双条件**（单关键词歧义时）：
- 退款在多渠道 → `summary 含"退款" AND counterparty_name 含"京东"`
- 转账作中转 → `summary 含"转账" AND counterparty_name 含"<实控人名>"`

## 8. MCP 服务器连接

**所有工具经** `POST http://localhost:3000/api/mcp`（JSON-RPC 2.0）。

### 测试
```bash
# 列工具
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 调工具
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"get_unclassified_transactions",
                 "arguments":{"brand":"gelatomiiix","month":"2026-05"}}}'
```

## 9. 文档与代码引用

| 内容 | 位置 |
|---|---|
| 45 工具完整参考 | [docs/mcp-tools.md](../../docs/mcp-tools.md) |
| 项目级指令 | [CLAUDE.md](../../CLAUDE.md) |
| 银行数据使用规范 | [docs/qmaireport/README.md](../../docs/qmaireport/README.md) |
| 工具实现 | [ui/src/mcp/tools/](../../ui/src/mcp/tools/) |
| 注册表 | [ui/src/mcp/server.ts](../../ui/src/mcp/server.ts) |
| JSON-RPC 端点 | [ui/src/app/api/mcp/route.ts](../../ui/src/app/api/mcp/route.ts) |
| MCP 服务器配置 | [ui/.mcp.json](../../ui/.mcp.json) |
