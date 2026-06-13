# WDG Data Foundation

Code repo for WDG — bank transactions + daily sales + delivery manifests → clean/classify/model → UI/Metabase.

## Tech Stack

- **ETL**: Python (psycopg2, pandas) — `scripts/`
- **DB**: PostgreSQL (Supabase) — `sql/` (layered: raw → ods → cfg → dm → views)
- **UI**: Next.js 14 + React 18 + TypeScript + TailwindCSS — `ui/`
- **BI**: Metabase

## Brands

| Brand | Schema prefix | Source data |
|-------|--------------|-------------|
| Gelatomiiix (`gelatomiiix`) | `brand_gelatomiiix_*` | Bank txns, cash register, income detail, product sales |
| Bonjur (`bonjur`) | `bonjur_*` | Daily sales, bank txns |
| Xintiandi (`xintiandi`) | `xintiandi_*` | Delivery manifests |

## Data Sources

| Type | Upload | Processing |
|------|--------|-------------|
| 银行流水 (bank transactions) | `/upload` → `import_*_bank_txn.py` | Rule-based classification → `fn_classify_bank_txn_v2` |
| 营业数据 (daily sales) | `/upload` → `import_*_sales_daily.py` | Materialized views → financial statements |
| 配送明细 (delivery manifests) | `/upload` → `import_xintiandi_delivery.py` | Xintiandi dashboard at `/xintiandi` |

## Bank Txn Classification Workflow

```
Upload → import script → raw.ingest_file + ods.bank_txn
                              ↓
                        fn_classify_bank_txn_v2 (rule-based)
                              ↓
                        dm.bank_txn_classified_snapshot
                              ↓
                     Unclassified? → MCP: submit_approval_proposal
                                               ↓
                                        Approval UI (/u/approvals)
                                               ↓
                                   Approve → settle as bank_rule_map rule
                                              + bank_txn_override
                                              + refresh snapshot
```

**Key paths**:
- Upload API: `ui/src/app/api/upload/route.ts`
- Classification SQL: `sql/10_*_fn_classify.sql` (per brand)
- Approval flow: `ui/src/app/u/approvals/`
- Batch action API: `ui/src/app/api/approval/proposals/batch-action/route.ts`

## MCP Server (Agent Tools)

Agent-accessible via `POST /api/mcp` (JSON-RPC 2.0). Tools:

| Tool | Purpose |
|------|---------|
| `get_brand_stores` | Brand + store metadata (code → name) |
| `upload_bank_txn_file` | Upload + trigger import, returns coverage stats |
| `get_unclassified_transactions` | Paginated list of unclassified txns |
| `get_existing_rules` | Current classification rules for brand |
| `submit_approval_proposal` | Submit LLM-generated proposals to approval queue |
| `query_approval_status` | Poll batch approval status |
| `get_transaction_detail` | Single txn detail + candidates |
| `get_candidates` | Keyword candidates for a txn |

MCP connection: `http://localhost:4100/api/mcp`

## Agent Chat (Admin + User UI)

Floating chat widget mounted on every `/u/*` page. Powered by the same Anthropic API as the MCP server, but exposed as a streaming SSE pipeline for real-time responses.

- **Right-side drawer** (default closed): resizable 320–640px, pushes the main content (no overlay). Open state + width persisted to `localStorage`. `Esc` closes, `Cmd/Ctrl+K` toggles.
- **Per-sentence streaming** with fade-in animation: the server splits assistant text into sentence-level chunks and emits them as SSE `text_block` events; the client renders each chunk as a separate bubble that fades in (CSS `animate-fadeIn`, ~140ms stagger).
- **Extended thinking** (admin toggle at `/u/admin/agent-config`): off / low (1K tokens) / medium (8K) / high (16K). Thinking text is emitted as `thinking_delta` events and rendered as a collapsed `💭` block that the user can click to expand.
- **MCP tool calls**: rendered as collapsible blocks showing the tool name, input, and result. Errors and retries are surfaced inline.
- **Token accounting**: Anthropic bills thinking tokens in `output_tokens`; soft/hard limits trigger prompt compaction or session abort respectively.

Key files:
- Drawer UI: `ui/src/components/chat/ChatDrawer.tsx`, `ui/src/components/chat/ChatWidget.tsx`
- Streaming route: `ui/src/app/api/chat/route.ts`
- Stream processor: `ui/src/lib/chat/stream-processor.ts`
- Thinking config: `ui/src/lib/chat/agent-config-store.ts` (`ThinkingLevel`, `thinkingConfigFor`)
- Sentence splitter: `ui/src/lib/chat/sentence-splitter.ts`

## Key Conventions

### Python
- Module-level DB config: `os.environ["DB_PASSWORD"]` (fail-fast, not `os.getenv`)
- Pipeline steps: `with pipeline_step(run_id, "step_name", conn)` from `ops_logger`
- DB: `psycopg2`, schema per brand

### TypeScript / Next.js
- DB: `@/lib/db` exports a `pg.Pool` instance
- Brand resolution: `normalizeBrand()` / `getDmSchemaSafe()` from `@/lib/brand-server`
- Auth: `getSessionUser()` / `assertRole()` from `@/lib/auth-server`
- Parameterized queries only: `pool.query(sql, params)` — no string interpolation

### SQL
- Numeric prefix = layer: `00_*` (infra) → `10_*` (cfg) → `20_*` (ods) → `30_*` (dm) → `40_*` (views) → `50_*` (analysis) → `60_*` (fixes)
- Idempotent: `IF NOT EXISTS` / `OR REPLACE`

## Agent Service (新增)

WDG Agent-First Product 的核心服务, 独立 Node.js 进程:

- **WebSocket 端点**: `ws://agent:4101/ws`
- **HTTP 健康检查**: `GET /health` → `{"status":"ok"}`
- **Prometheus metrics**: `GET /metrics`
- **复用既有 45 MCP tools**: 通过 `/api/mcp` 调

能力:
- 短期记忆 (PG `agent.conversations` / `agent.messages`)
- 任务队列 (PG `agent.tasks` / `agent.task_steps`)
- Skills (Y 方案按需加载, `agent/skills/*.md`)
- Cron 主动巡检 (周一 9 点跑 weekly_bank_review)
- 通知推送 (WebSocket 流式到 UI)

详见 [docs/agent-service.md](docs/agent-service.md) 和 spec [docs/superpowers/specs/2026-06-08-agent-first-product.md](docs/superpowers/specs/2026-06-08-agent-first-product.md).

## Development Commands

```bash
# Python (ETL)
cd /path/to/wdg-data-foundation
source .venv/bin/activate
pytest tests/ -v
python scripts/run_pipeline_oneclick.py --brand all --dry-run

# UI (Next.js)
cd ui
npm run dev        # Dev server on port 4100
npm run build      # Production build
npm run lint       # ESLint

# Docker (full stack)
docker compose up -d

# Bootstrap
bash init.sh
bash scripts/init_local_env.sh  # See docs/LOCAL_STARTUP.md
```

## Docs

- `docs/LOCAL_STARTUP.md` — local environment setup
- `docs/ACCEPTANCE_RUNBOOK.md` — end-to-end acceptance criteria
- `docs/XINTIANDI_MODULE.md` — Xintiandi module details
- `docs/productdata_schema.svg` — data model diagram
- `docs/skills/wdg-bank-workflow-SKILL.md` — MCP/Agent workflow spec (45 tools, 9 modules, write policy)

## Project Governance

Task board / acceptance evidence maintained in Obsidian (not tracked in this repo).