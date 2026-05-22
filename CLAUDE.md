# WDG Data Foundation

## Mission
Multi-brand restaurant chain data platform. Ingest bank transactions and daily sales, apply rule-based classification, build financial data marts (profit/cashflow/balance-sheet), serve via Next.js UI and Metabase.

## Project Structure
```
├── scripts/          # Python ETL pipeline (import, classify, ops logging)
├── sql/              # PostgreSQL DDL/DML, prefixed by layer:
│                     #   00_infrastructure → 10_cfg → 20_ods → 30_dm → 40_views → 50_analysis → 60_fixes
├── ui/               # Next.js 14 + React 18 + TypeScript + TailwindCSS
│   └── src/app/api/  # REST API routes (financial, rules, match, upload, pipeline, admin)
├── rules/            # JSON classification rule files
├── tests/            # Python pytest unit tests
├── ops/              # ops schema DDL
├── brand-docs/       # Brand-specific documentation
└── docs/             # Architecture, runbooks, acceptance criteria
```

## Key Conventions

### Database
- Schema per layer: `raw` → `{brand}_ods` → `{brand}_cfg` → `{brand}_dm` → `ops`
- SQL files in `sql/` should be idempotent (use `IF NOT EXISTS` / `OR REPLACE`)
- New SQL files must use numeric prefix matching the layer grouping above

### Python
- Module-level DB config uses `os.environ["DB_PASSWORD"]` (not `os.getenv` with fallback) — will error early if unset
- Pipeline steps use `pipeline_step()` context manager from `ops_logger` instead of manual `step_start`/`step_end`
- Include built-in CLI and test cases for classifier scripts (`if __name__ == '__main__'`)

### TypeScript / Next.js
- API route catch clauses: use `error: unknown` with `getErrorMessage()` from `@/lib/query-types` instead of `error: any`
- DB query results: type rows with typed interfaces from `@/lib/query-types` (ProfitRow, CashflowRow, etc.) rather than `as any`
- On '42P01' (relation does not exist) catch, return `success: true, data: null, note: 'view not ready'` for graceful degradation
- Use parameterized queries with `pool.query(sql, params)` — never interpolate user input

### Testing
- Python: `pytest tests/test_classify.py -v`
- Playwright config exists at `ui/playwright.config.ts`

## Acceptance Target
- Python tests pass: `pytest tests/ -v`
- UI builds: `cd ui && npx next build`
- Pipeline runs without error for all brands: `python scripts/run_pipeline_oneclick.py --brand all --dry-run`

## Constraints
- Keep changes bounded and reversible
- Do not claim done without verification evidence
- Financial statements are cash-basis (收付实现制), not accrual accounting — this is intentional and disclosed in the UI
- Never hardcode DB passwords — fallback 'postgres' defaults have been removed
- Prefer incremental snapshot-based classification over live-view computation
- Import scripts must remain idempotent via source_file_id tracking
