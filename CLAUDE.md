# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# WDG Data Foundation

Multi-brand restaurant chain data platform. Ingest bank transactions and daily sales, apply rule-based classification, build financial data marts (profit/cashflow/balance-sheet), serve via Next.js UI.

## Brands

| Brand | DB Schema Prefix | Source Data |
|-------|-----------------|-------------|
| Gelatomiiix (gelatomiiix) | `brand_gelatomiiix_ods` / `brand_yufeng_*` | Bank transactions, cash register, income detail, product sales |
| Bonjur (bonjur) | `bonjur_ods` / `bonjur_dm` | Daily sales |
| Xintiandi (xintiandi) | `xintiandi_*` | Delivery manifests (配送明细) |

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
│   └── bonjur_sales_daily_* / xintiandi/  # Brand-specific SQL
├── ui/                 # Next.js 14 + React 18 + TypeScript + TailwindCSS
│   ├── src/app/api/    # REST API routes
│   │   ├── financial/  # profit, cashflow, balance-sheet, counterparty, payment-metrics, overview
│   │   ├── gelatomiiix/ # income, sales (brand-specific endpoints)
│   │   ├── pipeline/   # kpi, rerun-match-by-file
│   │   ├── upload/     # File upload → import trigger
│   │   ├── match/      # Manual match & rule management
│   │   ├── rules/      # CRUD for classification rules
│   │   └── ...         # admin, auth, brands, categories, coverage, db, stores, xintiandi
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
- **dm** — financial data marts (profit/cashflow/balance-sheet per brand)
- **ops** — cross-brand operations logging, run tracking, pipeline_step

The classification pipeline: imported rows → `fn_classify()` (rule-based) → snapshot to classified table → materialized views → coverage reports.

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

## Constraints
- Keep changes bounded and reversible; verify before claiming done
- Never hardcode DB passwords or commit fallback defaults
- Import scripts idempotent via `source_file_id` tracking
- Prefer incremental snapshot-based classification over live-view computation
