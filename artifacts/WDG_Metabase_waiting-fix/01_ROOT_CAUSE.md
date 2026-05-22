# Root Cause Analysis: Metabase "Waiting for Results"

## Confirmed Root Causes

### RC-1: Port mismatch in compose files (8081 vs 8082) — CRITICAL
- `docker-compose.yml` line 21 and `docker-compose.dashboard.yml` line 21:
  `"${METABASE_PORT:-8081}:3000"` → defaults to **8081**
- CHANGELOG (2026-04-01) confirms: site-url was set to `http://112.124.18.246:8081`
  but Metabase actually runs on **8082**
- Fix was applied via direct API call on VPS (not captured in compose)
- Compose file NOT updated → if container restarts/recreates from compose, issue recurs

### RC-2: Month parameter missing values_source in seed script — ROOT CAUSE
- `scripts/metabase_seed_dashboard.py` defines Month (`month_date`) parameter at line 847:
  `{"id": PID_MONTH, "name": "Month", "slug": "month_date", "type": "date/month-year", "sectionId": "date", "required": False}`
- **No `values_source_config` / `values_source_type`** → no dropdown values
- CHANGELOG (2026-04-01): "为 Dashboard 8/9/10/5 的 Month 参数添加静态值列表" — this was
  a manual VPS API fix, NOT committed to seed script
- Without Month values, the `[[ AND extract(year from t.txn_time) = extract(year from {{month_date}})...]]`
  filter expands to all years/months → potentially massive scan → "waiting"

## Root Cause Summary
| | Port 8081 | Month no values_source |
|---|---|---|
| compose.yml | ✅ (still wrong) | N/A |
| seed script | N/A | ✅ (still wrong) |
| VPS API (2026-04-01) | ❌ was wrong, manually fixed | ❌ was wrong, manually fixed |
| Reproducible from repo? | YES (compose port wrong) | YES (seed missing fix) |

## Why Issue Persists / Returns
1. compose.yml not updated → redeploy from compose reintroduces port 8081
2. seed script not updated → re-running seed creates dashboards without Month values

## Evidence
- Commit 4402a46 ("ops: solidify WDG VPS compose") did NOT fix port 8081
- Commit 4f8ee61 ("fix metabase site-url + Month") did NOT fix compose.yml or seed script
- `ops/health.sh` correctly uses `METABASE_PORT:-8082` → proves 8082 is correct
- `scripts/metabase_seed_dashboard.py` default MB_URL: `http://localhost:3000` (not 8082)

## Fix Required
1. **docker-compose.yml**: Change `${METABASE_PORT:-8081}` → `${METABASE_PORT:-8082}`
2. **scripts/metabase_seed_dashboard.py**: Add Month `values_source_config` with month list
3. **scripts/metabase_seed_bonjur_ops_dashboard.py**: Same Month values fix
