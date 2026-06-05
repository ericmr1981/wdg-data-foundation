# MCP Tools Reference

> Single source of truth for the WDG data platform MCP server. Agent-facing — describes what each tool does, when to use it, and the write/read policy.

## Server

- **Endpoint**: `POST /api/mcp` (JSON-RPC 2.0)
- **Method**: `tools/list` (discover) · `tools/call` (invoke)
- **Header**: `x-mcp-session: internal` (auto-injected by tool wrappers)
- **Count**: 45 tools across 9 modules

## Agent write policy (important)

> **Agent exposes ONLY the proposal lane for any rule or approval decision.**
> All actual rule CRUD, approval decisions, and config changes stay human-gated.

| Operation | Exposed to Agent? | How it works |
|---|---|---|
| Read data (any kind) | ✅ Yes | MCP tools wrap `/api/...` GET endpoints |
| Upload files (bank, qimai, inventory) | ✅ Yes | `upload_*` tools (write raw ODS) |
| **Propose a rule** | ✅ Yes | `submit_proposal` → writes to approval queue (LLM reasoning + txn_ids) |
| **Re-run matching** (after rules settled) | ✅ Yes | `rerun_match_by_file` (refreshes snapshot) |
| Create / update / delete rules | ❌ NO | Human settles approved proposals in UI |
| Approve / reject proposals | ❌ NO | Human reviews in UI |
| Import / export / rollback rules | ❌ NO | Human in UI |
| Reorder rules | ❌ NO | Human in UI |
| Export xlsx (any binary) | ❌ NO | Use UI |

**Workflow**:
1. Agent uploads file (`upload_bank_txn_file`) → gets `source_file_id`
2. Agent finds unclassified txns (`get_unclassified_transactions`, `get_unclassified_by_file`)
3. Agent inspects each txn (`get_txn_detail`, `get_candidates`, `get_rules`)
4. Agent looks up valid categories (`list_categories`)
5. Agent **proposes** (`submit_proposal`) with LLM reasoning
6. **Human** reviews proposals in UI → settles approved ones to `bank_rule_map`
7. Agent re-runs matching (`rerun_match_by_file`) to apply new rules to historical data

---

## Tools by module

### 1. Bank-txn (11 tools)

| Tool | Purpose | Risk |
|---|---|---|
| `upload_bank_txn_file` | Upload bank .xlsx → trigger import → returns sourceFileId + coverage | write raw ODS |
| `get_unclassified_transactions` | List unclassified bank txns (filtered by brand/file/month) | read |
| `get_txn_detail` | Get full detail of a single txn (counterparty, summary, memo, purpose) | read |
| `get_candidates` | Get keyword candidates for rule `match_value` | read |
| `get_rules` | List existing classification rules for a brand | read |
| `preview_match` | Preview which historical txns a candidate match_value would hit | read |
| `submit_proposal` | Submit LLM proposal(s) into approval queue | write proposal (human settles) |
| `get_pipeline_kpi` | Get unclassified/auto/manual counts and amounts | read |
| `get_coverage_by_file` | Per-source-file coverage breakdown | read |
| `get_unclassified_by_file` | Per-source-file unclassified txn list | read |
| `rerun_match_by_file` | Refresh bank_txn_classified_snapshot for given source_files | write snapshot |

### 2. Approval (3 tools)

| Tool | Purpose |
|---|---|
| `submit_proposal` | (see above) |
| `get_proposal` | Get one proposal's full detail (status, LLM reasoning, missing_fields) |
| `query_approval_status` | Aggregate counts by status (pending/approved/rejected) |

### 3. Store-report (2 tools)

| Tool | Purpose |
|---|---|
| `query_store_report_snapshot` | Single store × month KPI snapshot (current + previous) |
| `query_store_report_trend` | 1-24 month time series of KPI metrics |

### 4. Financial (7 tools)

| Tool | Purpose |
|---|---|
| `query_financial_statement` | 3-in-1: profit / cashflow / balance_sheet (per brand, month/quarter/year) |
| `query_financial_overview` | Dashboard summary (revenue/cost/profit/cash/loan) |
| `query_financial_kpi_trend` | Time series for dashboard chart |
| `query_counterparty` | Counterparty analysis (in/out) |
| `query_income_metrics` | Income side metrics (channel mix, Qimai match rate) |
| `query_payment_metrics` | Payment side metrics (HR/MATERIAL/RENT/MKT breakdown) |
| `query_qimai_revenue` | Qimai gross/net/refund split by store |

### 5. Income (4 tools)

| Tool | Purpose |
|---|---|
| `upload_gelatomiiix_income_detail` | Upload Qimai income CSV → gelatomiiix_ods.income_detail |
| `upload_bonjur_income_detail` | Upload Qimai income CSV → bonjur_ods.income_detail |
| `query_gelatomiiix_income` | Query Qimai income detail records (paginated) |
| `get_qimai_entry_rate` | Gelatomiiix-only: channel-level Qimai-to-bank match rate |

### 6. Sales (11 tools)

| Tool | Purpose |
|---|---|
| `upload_bonjur_product_sales` | Upload product sales CSV → bonjur_ods.product_sales_detail |
| `upload_bonjur_sales_self_service` | Upload self-service daily sales CSV |
| `query_bonjur_qimai_sales` | Qimai POS sales detail (wechat/alipay POS) |
| `query_bonjur_sales_summary` | 3-in-1: overview/trend/channels for a store |
| `query_bonjur_sales_products` | Product-level sales (SKU ranking) |
| `query_bonjur_sales_details` | Transaction details (paginated, cash_register/qimai) |
| `query_gelatomiiix_sales_overview` | Monthly KPIs (revenue/order/avg ticket) |
| `query_gelatomiiix_sales_trend` | 12-month trend |
| `query_gelatomiiix_sales_channels` | Channel breakdown |
| `query_gelatomiiix_sales_products` | Product-level sales |
| `query_gelatomiiix_sales_details` | Transaction details (paginated) |
| `query_gelatomiiix_sales_distribution` | Order-count / revenue-share distribution |
| `query_gelatomiiix_sales_hourly` | Hourly distribution (peak hour analysis) |

### 7. Tamkoko inventory (1 tool)

| Tool | Purpose |
|---|---|
| `upload_tamkoko_inventory` | Upload inventory .xlsx → brand_tamkoko_ods.inventory_month_end |

### 8. Metadata (4 tools)

| Tool | Purpose |
|---|---|
| `get_brand_stores` | Brand + store code/name lookup |
| `list_categories` | Category dictionary (lvl1/lvl2 codes + names) |
| `list_rule_groups` | Rule groups listing |
| `list_rule_files` | Rule source files (Excel imports) |

### 9. Audit (1 tool)

| Tool | Purpose |
|---|---|
| `get_rules_history` | Per-rule change history (who/when/from→to) |

---

## Common parameters

- **`brand`**: enum `gelatomiiix | yufeng | bonjur` (default `yufeng` for legacy compat). Use `yufeng` or `gelatomiiix` interchangeably — `normalizeBrand()` resolves both.
- **`period`**: YYYY-MM format
- **`span`**: `month` | `quarter` | `year` (default `month`)
- **`store` / `store_code`**: store code or `all` (default `all`)
- **`pure_mode`**: boolean (gelatomiiix sales only) — exclude membership / discount / refund

## Skipped (deliberate gaps)

| Tool | Reason |
|---|---|
| xintiandi dashboard / batch / upload | `xintiandi` schema not deployed; tool calls return 500 |
| `export_rules` (xlsx) | `xlsx` package not installed in node_modules; binary endpoint |
| `create_rule` / `update_rule` / `delete_rule` | Agent write policy — human in UI |
| `settle_rule` / `settle_rules_batch` | Same — settlements require human review |
| `approve_proposal` / `reject_proposal` / `batch_action_proposals` | Same — approval decisions are human |
| `import_rules` / `rollback_rule` / `reorder_rules` | Same — cfg changes are human |

## Code reference

- Tool wrappers: [ui/src/mcp/tools/](ui/src/mcp/tools/) (one file per tool, thin zod + fetch)
- Registry: [ui/src/mcp/server.ts](ui/src/mcp/server.ts)
- JSON-RPC handler: [ui/src/app/api/mcp/route.ts](ui/src/app/api/mcp/route.ts)
- Server config: [ui/.mcp.json](ui/.mcp.json)
