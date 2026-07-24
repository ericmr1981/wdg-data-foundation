# MCP Tools Reference

> Single source of truth for the WDG data platform MCP server. Agent-facing — describes what each tool does, when to use it, and the write/read policy.

## Server

- **Endpoint**: `POST /api/mcp` (JSON-RPC 2.0)
- **Method**: `tools/list` (discover) · `tools/call` (invoke)
- **Header**: `x-mcp-session: internal` (auto-injected by tool wrappers)
- **Count**: 49 tools across 10 modules

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

> **破例 — 2026-06-08**: `create_store` 是首个直接落库的 create 类工具(此前 create/update/delete/settle/approve/reject/import/rollback/reorder 全部不对 agent 暴露)。本工具走 MCP service token 鉴权,事务原子,5 条不变量验证"创建后立刻能用"。Agent 需在用户明确授权后才调用,禁止自动 retry。

---

## Tools by module

### 1. Bank-txn (11 tools)

| Tool | Purpose | Risk |
|---|---|---|
| `upload_bank_txn_file` | Upload bank .xlsx → trigger import → returns sourceFileId + coverage (supports gelatomiiix/yufeng/bonjur/tamkoko) | write raw ODS |
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
| `upload_tamkoko_income_detail` | Upload Qimai income CSV → brand_tamkoko_ods.income_detail |
| `query_gelatomiiix_income` | Query Qimai income detail records (paginated) |
| `get_qimai_entry_rate` | Gelatomiiix-only: channel-level Qimai-to-bank match rate |

### 6. Sales (11 tools)

| Tool | Purpose |
|---|---|
| `upload_bonjur_product_sales` | Upload product sales CSV → bonjur_ods.product_sales_detail |
| `upload_gelatomiiix_product_sales` | Upload product sales CSV → gelatomiiix_ods.product_sales_detail |
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

### 9. Store creation (1 tool)

| Tool | Purpose | Risk |
|---|---|---|
| `create_store` | Create a new store under an existing brand. Writes `ops.stores` + `{brand}_cfg.dim_store` in one transaction, optionally copies cfg rule snapshots from a sibling store. Behavior matches the admin `/u/admin/stores` page exactly. New store is immediately importable, viewable in UI, and queryable by MCP. | **直接落库** — first create-class exception; requires `WDG_SERVICE_TOKEN` (see policy break note above) |

**Inputs**:

- `brand` (required): existing brand code in `ops.brands`, e.g. `gelatomiiix`
- `store_code` (required): `^[a-z][a-z0-9_]{1,31}$`
- `store_name` (required): `^[一-龥A-Za-z0-9\s\-_]{1,64}$`
- `rule_snapshot_source_store_code` (optional): same-brand enabled store to clone cfg from
- `rule_snapshot_tables` (optional): whitelist array, default `["bank_rule_map"]`

**Success response**: `{ ok: true, store: { brand, store_code, store_name, enabled, sort_order, updated }, rule_snapshot: { applied, source_store_code?, tables_copied: [...], tables_skipped: [...] } }`. `updated: true` indicates the row was upserted (not a fresh insert); rule snapshot is **not** re-copied on `updated: true` (avoids double rows).

**Error codes** (subset — see spec §2.1 for full list): `invalid_brand_code` · `invalid_store_code` · `invalid_store_name` · `unknown_rule_snapshot_table` · `forbidden` · `forbidden_mcp` · `brand_not_found` · `brand_disabled` · `cfg_schema_not_allowed` · `source_store_brand_mismatch` · `rule_snapshot_table_too_large`.

**5 invariants** (verified by e2e `stores-create-mcp.spec.ts`):

1. `GET /api/stores?brand={brand}` includes the new store row
2. `SELECT 1 FROM {brand}_cfg.dim_store WHERE store_code = {store_code}` returns a hit
3. `SELECT 1 FROM {brand}_dm.v_store_monthly_kpi WHERE store_code = {store_code}` does not throw (empty set OK)
4. `upload_bank_txn_file` / `upload_*_income_detail` referencing the new `store_code` is not rejected by FK/CHECK
5. `get_brand_stores` returns the new store

### 10. Audit (1 tool)

| Tool | Purpose |
|---|---|
| `get_rules_history` | Per-rule change history (who/when/from→to) |

---

## Common parameters

- **`brand`**: enum `gelatomiiix | yufeng | bonjur | tamkoko` (default `yufeng` for legacy compat). Use `yufeng` or `gelatomiiix` interchangeably — `normalizeBrand()` resolves both.
- **`period`**: YYYY-MM format
- **`span`**: `month` | `quarter` | `year` (default `month`)
- **`store` / `store_code`**: store code or `all` (default `all`)
- **`pure_mode`**: boolean (gelatomiiix sales only) — exclude membership / discount / refund

## Skipped (deliberate gaps)

| Tool | Reason |
|---|---|
| xintiandi dashboard / batch / upload | `xintiandi` schema not deployed; tool calls return 500 |
| `export_rules` (xlsx) | `xlsx` package not installed in node_modules; binary endpoint |
| `create_rule` / `update_rule` / `delete_rule` | Agent write policy — human in UI (`create_store` is the only create-class exception; see section 9 above) |
| `settle_rule` / `settle_rules_batch` | Same — settlements require human review |
| `approve_proposal` / `reject_proposal` / `batch_action_proposals` | Same — approval decisions are human |
| `import_rules` / `rollback_rule` / `reorder_rules` | Same — cfg changes are human |

## Code reference

- Tool wrappers: [ui/src/mcp/tools/](ui/src/mcp/tools/) (one file per tool, thin zod + fetch)
- Registry: [ui/src/mcp/server.ts](ui/src/mcp/server.ts)
- JSON-RPC handler: [ui/src/app/api/mcp/route.ts](ui/src/app/api/mcp/route.ts)
- Server config: [ui/.mcp.json](ui/.mcp.json)
