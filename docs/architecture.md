# WDG Data Foundation — Architecture

## Overview

A data platform for multi-brand restaurant chains. Ingests bank transactions and daily sales data, applies rule-based classification, builds financial data marts, and serves reports via a web UI and Metabase.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Sources                             │
│  银行流水.xlsx  (bank transactions)                              │
│  营业数据.csv    (daily/store-level sales)                       │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Import Layer (Python)                               │
│  scripts/import_yufeng_bank_txn.py                               │
│  scripts/import_bonjur_sales_daily.py                            │
└──────────────────────┬──────────────────────────────────────────┘
                       │ raw.ingest_file tracking
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Database — PostgreSQL                               │
│                                                                  │
│  raw       ──→  ingest_file, ingest_file_column                  │
│  {brand}_ods ──→  bank_txn, sales_monthly                       │
│  {brand}_cfg ──→  bank_rule_map, category_dictionary             │
│  {brand}_dm  ──→  v_profit_statement, v_cashflow_statement,     │
│                   v_balance_sheet, v_coverage_monthly            │
│  ops        ──→  pipeline_run, pipeline_step_run, brands, stores │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              API Layer  (Next.js API routes)                      │
│  /api/financial/*    ──  profit, cashflow, balance-sheet         │
│  /api/rules/*        ──  CRUD for classification rules           │
│  /api/match/*        ──  transaction matching interface          │
│  /api/coverage/*     ──  coverage statistics                     │
│  /api/upload/*       ──  file upload and import                  │
│  /api/admin/*        ──  brands, stores, category dictionary     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              UI Layer  (Next.js / React / TailwindCSS)            │
│  /financial     ──  profit/cashflow/balance-sheet statements     │
│  /rules         ──  classification rule management               │
│  /match         ──  manual transaction matching                  │
│  /upload        ──  file upload                                 │
│  /pipeline      ──  pipeline monitoring                          │
│  /admin/*       ──  brands, stores, category dictionary          │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
raw_ingest_file (tracking)
       │
       ▼
ODS (原始数据) — raw data as-is, minimal cleaning
       │
       ▼
CFG (规则配置) — classification rules, category dictionaries
       │
       ▼
DM (数据模型) — aggregated views: profit, cashflow, balance-sheet, coverage
```

Each layer is separated by PostgreSQL schema: `raw`, `{brand}_ods`, `{brand}_cfg`, `{brand}_dm`, `ops`.

## Brand Architecture

Two brands share the same architecture with per-brand schemas:

| Brand   | ODS schema    | CFG schema     | DM schema       | Store codes    |
|---------|---------------|----------------|-----------------|----------------|
| Yufeng  | `yufeng_ods`  | `yufeng_cfg`   | `yufeng_dm`     | yf_gh          |
| Bonjur  | `bonjur_ods`  | `bonjur_cfg`   | `bonjur_dm`     | bj_xx, bj_xx   |

## Tech Stack

| Layer         | Technology                     |
|---------------|--------------------------------|
| Database      | PostgreSQL 16                  |
| Backend API   | Next.js 14 API Routes (Node.js)|
| Frontend      | Next.js 14 / React 18 / TypeScript / TailwindCSS |
| ETL Scripts   | Python 3 (psycopg2)            |
| Classification| JSON rule files + SQL functions + Python CLI |
| Testing       | pytest (Python), Playwright (E2E, planned) |
| BI            | Metabase (external)            |

## Classification Engine

Transactions are classified using a rule-based approach with field priority:

1. Rules are stored as JSON (`rules/yufeng_bank_rules.json`) and mirrored in DB (`{brand}_cfg.bank_rule_map`)
2. Match field priority: `summary → memo → purpose → counterparty_name`
3. Each rule specifies `match_type`: `contains`, `exact`, or `regex`
4. Optional `direction` filter (`in` / `out` / `any`)
5. Optional AND-match via `match_field2` / `match_value2`

Python implementation: `scripts/classify.py`
SQL implementation: `sql/*fn_classify_v2.sql`

## Key Design Decisions

- **收付实现制 (cash basis)** — Financial statements are based on cash flow, not accrual accounting. This is intentional and disclosed in the UI.
- **Snapshot-based classification** — Classification results are materialized to tables (snapshots) rather than computed live via views, for performance.
- **Idempotent imports** — Import scripts use `source_file_id` to track which files have been processed, allowing safe re-runs.
- **Ops logging** — Every pipeline run and step is logged to `ops.pipeline_run` / `ops.pipeline_step_run` for observability and debugging.

## Dependency Rules

- `brand-docs/` → `sql/` (documentation precedes schema)
- `sql/` → `scripts/` (schema must exist before scripts run)
- `scripts/` → `ui/` (pipeline creates data that the UI consumes)
- `ui/src/lib/` → `ui/src/app/api/` (shared lib used by API routes)
- `ui/src/app/api/` → `ui/src/app/` (API feeds page components)
