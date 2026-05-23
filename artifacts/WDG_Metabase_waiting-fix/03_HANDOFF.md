# Handoff Packet — WDG Metabase "Waiting for Results" Fix

**Subagent:** paul_operator  
**Repo:** /Users/ericmr/Documents/GitHub/wdg-data-foundation  
**Session:** agent:paul_operator:subagent:79b352fd-d34a-4c9c-a2fa-17c342bd5286  
**Local Oracle:** ✅ PASSED (`bash scripts/run_change_guard.sh` → 16/16 pytest pass)

---

## Status: Done (3 files changed, 1 blocker)

### Changed Files

| File | Change | Lines |
|------|--------|-------|
| `docker-compose.yml` | Port 8081→8082 for Metabase | Line 21 |
| `scripts/metabase_seed_dashboard.py` | Added `month_values_for_brand()` + updated dash_params | +52 lines |
| `scripts/metabase_seed_bonjur_ops_dashboard.py` | Added Month `values_source_config` | +9 lines |

---

## Root Cause Evidence

**The 2026-04-01 VPS fix was NOT captured in the repo:**
- Commit 4f8ee61 ("fix metabase site-url + Month") updated CHANGELOG.md/ProjectTasks.md only
- `docker-compose.yml` still has `${METABASE_PORT:-8081}` (wrong port)
- `scripts/metabase_seed_dashboard.py` Month param still lacks `values_source_config`
- Re-deploying from compose (or re-running seed) would reintroduce BOTH issues

**Port inconsistency in repo (before fix):**
```
docker-compose.yml:          ${METABASE_PORT:-8081}   ← wrong
docker-compose.dashboard.yml: ${METABASE_PORT:-8081}   ← wrong
ops/health.sh:               ${METABASE_PORT:-8082}     ← correct
scripts/metabase_seed_dashboard.py MB_URL: http://localhost:3000 (comment says 8082)
```

---

## Bounded Bet Implemented

**Bet:** Fixing the compose port default to 8082 prevents the most likely regression (container restart re-introduces wrong port). Adding `month_values_for_brand()` to the seed script ensures Month filter is populated from actual data, eliminating the "all years" full scan.

**Risk:** The `month_values_for_brand()` dynamic query runs at seed time. If the database has no data yet for a brand, it returns `[]` (graceful). The function is wrapped in try/except.

---

## Evidence

- ✅ `python3 -m py_compile` both scripts → OK
- ✅ `python3 scripts/metabase_seed_dashboard.py --help` → OK
- ✅ Local oracle (`bash scripts/run_change_guard.sh`) → 16/16 pytest PASS

---

## ⚠️ BLOCKER — VPS Access Required

**Cannot verify the final oracle (live Metabase acceptance) without SSH access to VPS.**

The compose fix is in the repo, but it has NOT been deployed to VPS yet. The current VPS compose may still be on port 8081.

**Main agent needs to run on VPS (as Boss):**
```bash
# 1. Verify current port
ssh root@112.124.18.246 "docker ps --format '{{.Ports}}' | grep metabase"

# 2. If port is 8081, update .env and restart
ssh root@112.124.18.246 "echo 'METABASE_PORT=8082' >> /root/wdg-data-foundation/.env"
ssh root@112.124.18.246 "cd /root/wdg-data-foundation && docker-compose restart metabase"

# 3. Verify site-url (get API key from .env first)
ssh root@112.124.18.246 "grep METABASE_API_KEY /root/wdg-data-foundation/.env"

# 4. Check site-url via API
API_KEY=$(ssh root@112.124.18.246 "grep METABASE_API_KEY /root/wdg-data-foundation/.env | cut -d= -f2")
ssh root@112.124.18.246 "curl -s -H 'X-Api-Key: $API_KEY' http://localhost:8082/api/setting/site-url"
# Should return: "http://112.124.18.246:8082"
```

**Full VPS verification commands:** see `artifacts/WDG_Metabase_waiting-fix/02_VPS_VERIFICATION.md`

---

## Next Steps (Priority Order)

1. **[VPS] Fix METABASE_PORT on VPS** — update `.env` to `METABASE_PORT=8082` and `docker-compose restart metabase`
2. **[VPS] Verify site-url** — ensure it reads `http://112.124.18.246:8082` (not 8081)
3. **[VPS] Re-run seed script** — `python3 scripts/metabase_seed_dashboard.py --brand <brand>` for each brand to re-apply Month values
4. **[Browser] Live acceptance** — open dashboards 8/9/10, verify cards load within 30s with data
5. **[Repo] Commit** — git add + commit the 3 changed files (do NOT push to origin in this session)

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-------------|
| VPS still runs on 8081 | HIGH | Fix .env on VPS (Step 1 above) |
| site-url reverted to 8081 | MEDIUM | Check API and reset via curl if needed |
| Month filter still shows empty after seed | LOW | Check `values_source_config` in dashboard params API |
| DM views missing for brand | LOW | Run `sql/brand_dm_models.sql` for missing brands |
