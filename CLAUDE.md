# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# WDG Data Foundation

Multi-brand restaurant chain data platform. Ingest bank transactions and daily sales, apply rule-based classification, build financial data marts (profit/cashflow/balance-sheet), serve via Next.js UI.

## Brands

Three brands live in `ops.brands`. Schema prefix follows the `brand_{code}_*` convention except `bonjur` and `yufeng` (legacy).

| Brand (code) | Display | Schema prefix | Stores | Source data |
|---|---|---|---|---|
| `gelatomiiix` | 蜜可诗 | `brand_gelatomiiix` (alias: `gelatomiiix`, `brand_yufeng`) | sh_sc (供应链), sh_xtd (上海新天地店) | Bank transactions, income detail, product sales, cash register |
| `bonjur` | Bonjour / 旺鼎阁 | `bonjur` | sh_wdg (总公司), wz_ra (瑞安), wz_wxc (温州万象城) | Daily sales (Qimai) |
| `tamkoko` | 泰柯茶园 | `brand_tamkoko` | hz_fuyang (富阳), wz_bjwxc (滨江万象城) | POS income, inventory month-end (planned) |

> **Note:** `xintiandi` is a **template schema** (`sql/xintiandi/`, `LIKE xintiandi.delivery_detail`) used by `/api/admin/brands` to provision delivery modules for new brands. It is **not** a real brand or store; not in `ops.brands`, not in `ops.stores`. Its DDL has never been executed in production DB.

## Development Commands

```bash
# Python (ETL pipeline)
cd /path/to/wdg-data-foundation-dev
source .venv/bin/activate
pytest tests/ -v                       # Run all Python tests
pytest tests/test_classify.py -v       # Single test file
python scripts/run_pipeline_oneclick.py --brand all --dry-run   # Pipeline dry run

# UI (Next.js)
cd ui
npm run dev              # Dev server on port 4100
npm run build            # Production build
npm run lint             # ESLint
npm run test:e2e         # Playwright E2E
npx playwright test --ui # Playwright UI mode

# Docker (full stack)
docker compose up -d                   # Postgres + UI

# Bootstrap
bash init.sh              # Python venv + compile check
bash scripts/init_local_env.sh  # Full local env init (see docs/LOCAL_STARTUP.md)
```

## Project Structure

```
├── scripts/            # Python ETL pipeline
│   ├── run_pipeline_oneclick.py   # Orchestrator: import → classify → refresh → verify
│   ├── ops_logger.py              # Pipeline step logging context manager
│   ├── classify.py                # Classification engine (rule-based)
│   ├── import_*.py                # Per-brand/source import scripts
│   ├── create_views.py            # Materialized view refresh
│   └── run_drift_check.sh         # Schema drift detection
├── sql/                # PostgreSQL DDL/DML, prefixed by layer:
│   ├── 00_*            # Infrastructure (schemas, file tracking, rule grouping, history)
│   ├── 10_*            # Config (CFG) — rule maps, category dictionaries, classify functions
│   ├── 20_*            # ODS — raw data tables, store dims
│   ├── 30_*            # DM — data mart models (profit, cashflow, balance sheet)
│   ├── 40_*            # Views & snapshots — apply classification, coverage reports, financial statements
│   ├── 50_*            # Analysis — match preview, regression checks, rule settling
│   ├── 60_*            # Fixes — post-hoc corrections
│   ├── bonjur_sales_daily_*        # Bonjur daily-sales DDL (legacy split)
│   └── xintiandi/                  # ⚠️ Template schema (not deployed); cloned by /api/admin/brands
├── ui/                 # Next.js 14 + React 18 + TypeScript + TailwindCSS
│   ├── src/app/api/    # REST API routes
│   │   ├── financial/  # profit, cashflow, balance-sheet, counterparty, payment-metrics, overview, kpi-trend, income-metrics, qimai-revenue
│   │   ├── gelatomiiix/ # income (qimai-detail / bank-entry-stats / upload-qimai), sales (overview/trend/channels/products/details/distribution/hourly)
│   │   ├── bonjur/      # income (bank-entry-stats / upload-qimai), sales (overview/trend/channels/products/details/qimai-pos/upload-*)
│   │   ├── tamkoko/     # upload (inventory .xlsx → DB)
│   │   ├── xintiandi/   # ⚠️ delivery template (dashboard / batch / upload) — depends on xintiandi schema, currently NOT deployed
│   │   ├── pipeline/    # kpi, rerun-match-by-file
│   │   ├── upload/      # Bank file upload → import trigger
│   │   ├── match/       # txn detail, unclassified, candidates, preview, override
│   │   ├── rules/       # CRUD + settle / settle-batch / reorder / rollback / import / export / history / files
│   │   ├── rule-groups/ # Group reorder
│   │   ├── approval/    # proposals (POST/GET) + [id] + batch-action
│   │   ├── coverage/    # by-file / unclassified-by-file
│   │   └── admin/       # brands, stores, users, rules-copy, category-dictionary, brand-category-dictionary
│   │   └── ...          # auth, brands, categories, db/introspect, stores, mcp, income (cross-brand bank-entry-stats)
│   ├── src/app/u/      # Unified pages: income, payment, sales, financial
│   └── src/lib/        # Shared: db.ts (pg pool), query-types.ts, brand-server.ts, auth-server.ts
├── rules/              # JSON classification rule files (yufeng_bank_rules.json)
├── tests/              # Python pytest unit tests (test_classify.py, test_import_*.py)
├── ops/                # Ops schema DDL + health checks + backup scripts
├── brand-docs/         # Per-brand ODS DDL, field mapping, classification rules
├── docs/               # Architecture, runbooks, acceptance criteria, startup guide
└── supabase/           # Supabase migrations
```

## Database Architecture

Schema layers per brand (idempotent SQL, `IF NOT EXISTS` / `OR REPLACE`):

```
raw  →  {brand}_ods  →  {brand}_cfg  →  {brand}_dm  →  40_* views
  (import)     (store)       (rules)        (marts)      (materialized)
```

- **raw** — ingested source files with source_file_id tracking (idempotent uploads)
- **ods** — cleaned/typed source tables, store dimensions
- **cfg** — rule maps, classification functions, category dictionaries
- **dm** — financial data marts (profit/cashflow/balance-sheet per brand) + `v_store_monthly_kpi` view (per brand)
- **ops** — cross-brand operations logging, run tracking, pipeline_step, brand/store/allowed_schemas registry

**Allowed schemas** are registered in `ops.allowed_schemas` and gate API access. New brands are added via `/api/admin/brands` POST, which provisions `{brand}_ods/_cfg/_dm/_ops` and optionally `{brand}_delivery` cloned from the `xintiandi` template.

**The classification pipeline**: imported rows → `fn_classify()` (rule-based) → snapshot to classified table → materialized views → coverage reports.

## ETL Pipeline Flow

`run_pipeline_oneclick.py` orchestrates per brand:
1. **Import** — runs `import_*.py` scripts (idempotent via source_file_id)
2. **Classify** — applies `fn_classify()` via SQL, stores snapshot in `_{brand}_classified` tables
3. **Refresh views** — runs `create_views.py` for materialized views
4. **Verify** — outputs coverage rates, unclassified top-N, source_file_id trace

## Key Conventions

### Python
- Module-level DB config: `os.environ["DB_PASSWORD"]` (not `os.getenv` — fails fast if unset)
- Pipeline steps: `with pipeline_step(run_id, "step_name", conn) as ctx:` from `ops_logger`
- Classifier scripts include `if __name__ == '__main__'` CLI + test cases
- DB: `psycopg2`, schema per brand, password from env

### TypeScript / Next.js
- API catch: `error: unknown` with `getErrorMessage()` from `@/lib/query-types`
- Query rows typed with interfaces from `@/lib/query-types` (ProfitRow, CashflowRow, etc.)
- On '42P01' (view not ready): `return {success: true, data: null, note: 'view not ready'}`
- Parameterized queries only: `pool.query(sql, params)` — no interpolation
- DB connection: `@/lib/db` exports a `pg.Pool` instance
- Brand resolution: `normalizeBrand()` / `getDmSchemaSafe()` from `@/lib/brand-server`
- Auth: `getSessionUser()` / `assertRole()` from `@/lib/auth-server`
- Period parsing: `parsePeriod()` from `@/app/api/financial/period-utils`

### SQL
- Files numeric-prefixed by layer: `00_infrastructure` → `10_cfg` → `20_ods` → `30_dm` → `40_views` → `50_analysis` → `60_fixes`
- Idempotent: `IF NOT EXISTS` / `OR REPLACE`
- New SQL must match the layer prefix ordering

## Acceptance Target
- `pytest tests/ -v` passes
- `cd ui && npx next build` succeeds
- `python scripts/run_pipeline_oneclick.py --brand all --dry-run` completes without error
- Financial statements are cash-basis (收付实现制) — disclosed in UI

## Bank Data Usage规范

所有与银行流水相关的数据分析 API **必须使用 `bank_txn_classified_snapshot`（预分类快照）**，不得独立执行 `bank_rule_map` 模糊匹配或直接调用 `fn_classify()`。

```
bank_txn → fn_classify() → bank_txn_classified_snapshot (BASE TABLE)
                               ↑ 所有 API 只读这里，不做二次匹配
```

分类只跑一次，所有页面口径统一。详见 [docs/qmaireport/README.md](docs/qmaireport/README.md) 审计摘要。

## MCP Tools (Agent 接口)

46 个 MCP 工具经 `POST /api/mcp` 暴露，封装 `/api/...` 端点供 Agent 调用。详见 [docs/mcp-tools.md](docs/mcp-tools.md)。

**Agent 写权限原则**：Agent **只能** `submit_proposal`（写审批队列）/ `rerun_match_by_file`（刷新 snapshot）/ `upload_*`（写 raw ODS）。所有规则 CRUD、审批决策、cfg 变更由**人工在 UI 完成**（提案→审→settle）。MCP 工具按"Agent 提议 → 人工审 → 落定"两阶段模式暴露。

| 模块 | 工具数 | 主要工具 |
|---|---|---|
| 银行流水 | 11 | upload_bank_txn_file · submit_proposal · rerun_match_by_file · get_unclassified_by_file · get_coverage_by_file |
| 审批 | 3 | submit_proposal · get_proposal · query_approval_status |
| 门店月报 | 2 | query_store_report_snapshot / _trend |
| 门店创建 | 1 | `create_store` · 直接落库 · **首个 create 类破例**,需 service token |
| 财务 | 7 | query_financial_statement (3-in-1) · query_financial_overview · _kpi_trend · query_counterparty · query_income_metrics · _payment_metrics · _qimai_revenue |
| 收入 | 4 | upload_gelatomiiix_income_detail · upload_bonjur_income_detail · upload_tamkoko_income_detail · query_gelatomiiix_income · get_qimai_entry_rate |
| 销售 | 12 | gelatomiiix 7 件 + bonjur 4 件 + upload_gelatomiiix_product_sales |
| Tamkoko 库存 | 1 | upload_tamkoko_inventory |
| 元数据 | 4 | get_brand_stores · list_categories · list_rule_groups · list_rule_files |
| 审计 | 1 | get_rules_history |

**已撤 / 永久跳过**：`xintiandi.*` 工具（schema 未部署）、`export_rules`（xlsx 包未装）、所有 `create/update/delete/settle/approve/reject/import/rollback/reorder` 类写工具。

## Reminders & Reports (站内通知与月报)

4 类系统主动通知,统一写在 `ops.notification` 表,通过顶部 `<NotificationBell>` 显示。

| 类型 | 检测时机 | 检测源 |
|---|---|---|
| `data_stale` | 每日 09:00 | 企迈 `MAX(biz_date) < T-1` 或 银行流水 `MAX(txn_date) < 月初 5 日` |
| `unmatched_txn` | 每日 09:30 | `{brand}_dm.v_unclassified_top` COUNT > 0 |
| `dup_rule` | 每日 09:30 | `{brand}_cfg.bank_rule_map` 同 pattern_hash > 1 条 |
| `monthly_report` | 每月 6 日 06:00 | 聚合 `dm.v_store_monthly_kpi` → 写 xlsx → `/var/wdg/reports/{brand}/` |

**调度**:`scripts/wdg_scheduler_daemon.py` (APScheduler BlockingScheduler) 由 systemd `wdg-scheduler.service` 拉起,`/reload` HTTP 端点热加载。
**配置**:UI `/admin/config/notifications` 可改 cron + 品牌过滤,改完自动重载。
**入口**:`scripts/run_notification_sweep.py --task {name} --brands {csv}` 手动跑;详见 `docs/superpowers/specs/2026-06-07-notifications-design.md`。
**部署**:VPS `systemctl enable --now wdg-scheduler`,详见 `docs/LOCAL_STARTUP.md` 末段。

**v2 增量**: 未配条目现在会自动调 Claude 分析并写入 `ops.approval_proposal` 等待审批。提醒的 `action_url` 指向 `/u/approvals?source=unmatched&brand=...&batch=...&filter=pending`,审批页顶部显示批次横幅。`sweep_notifications.py` 通过 `X-Service-Token` 头调 `/api/admin/analyze-unclassified`,service token 存 `ops.service_token` 表(SHA-256 哈希,raw 仅在 env)。

## Documentation Index

| 文档 | 位置 | 内容 |
|---|---|---|
| 架构说明 | [docs/architecture.md](docs/architecture.md) | 系统架构总览 |
| 本地启动 | [docs/LOCAL_STARTUP.md](docs/LOCAL_STARTUP.md) | 开发环境搭建 |
| **MCP 工具参考** | [docs/mcp-tools.md](docs/mcp-tools.md) | 46 个 Agent 工具完整清单 + 写权限原则 |
| **页面文档 (qmaireport)** | [docs/qmaireport/README.md](docs/qmaireport/README.md) | 索引 + 全站银行数据审计 |
| ├ 收入分析 | [docs/qmaireport/income-page-structure.md](docs/qmaireport/income-page-structure.md) | /u/income 结构 |
| │ | [docs/qmaireport/income-data-sources.md](docs/qmaireport/income-data-sources.md) | /u/income 数据来源 |
| │ | [docs/qmaireport/income-user-stories.md](docs/qmaireport/income-user-stories.md) | /u/income 用户故事 |
| ├ 财务报表 | [docs/qmaireport/financial-page-structure.md](docs/qmaireport/financial-page-structure.md) | /u/financial, /u/payment, /u/dashboard 结构 |
| │ | [docs/qmaireport/financial-data-sources.md](docs/qmaireport/financial-data-sources.md) | 数据来源 |
| │ | [docs/qmaireport/financial-user-stories.md](docs/qmaireport/financial-user-stories.md) | 用户故事 |
| ├ 销售分析 | [docs/qmaireport/sales-page-structure.md](docs/qmaireport/sales-page-structure.md) | /u/sales, /u/sales/details 结构 |
| │ | [docs/qmaireport/sales-data-sources.md](docs/qmaireport/sales-data-sources.md) | 数据来源 (不涉及银行流水) |
| │ | [docs/qmaireport/sales-user-stories.md](docs/qmaireport/sales-user-stories.md) | 用户故事 |
| ├ 管道上传 | [docs/qmaireport/pipeline-page-structure.md](docs/qmaireport/pipeline-page-structure.md) | /upload, /pipeline 结构 |
| │ | [docs/qmaireport/pipeline-data-sources.md](docs/qmaireport/pipeline-data-sources.md) | 数据来源 |
| │ | [docs/qmaireport/pipeline-user-stories.md](docs/qmaireport/pipeline-user-stories.md) | 用户故事 |
| └ 匹配规则 | [docs/qmaireport/match-page-structure.md](docs/qmaireport/match-page-structure.md) | /match, /rules 结构 |
|   | [docs/qmaireport/match-data-sources.md](docs/qmaireport/match-data-sources.md) | 数据来源 |
|   | [docs/qmaireport/match-user-stories.md](docs/qmaireport/match-user-stories.md) | 用户故事 |
| **VPS systemd 部署** | [docs/SYSTEMD_DEPLOY.md](docs/SYSTEMD_DEPLOY.md) | install / 数据迁移 / 运维 |

## Constraints
- Keep changes bounded and reversible; verify before claiming done
- Never hardcode DB passwords or commit fallback defaults
- Import scripts idempotent via `source_file_id` tracking
- Prefer incremental snapshot-based classification over live-view computation
