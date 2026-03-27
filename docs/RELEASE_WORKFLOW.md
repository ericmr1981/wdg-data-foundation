# WDG Release Workflow (Standard)

This is the standard development → release workflow for WDG (local dev + local Docker gate + GitHub + VPS conservative sync).

## 0) Local development (fast loop)
Goal: iterate quickly.

- UI: `cd ui && npm run dev`
- DB: use local Docker Postgres (`localhost:5432`) or the standard local stack.

Acceptance for this phase:
- feature works as intended in dev
- no obvious UI/runtime errors

## 1) Pre-release gate: Local Docker (production-like)
Goal: catch production-build / container-env issues.

1. Rebuild UI image + restart local UI container.
2. Run **local Docker smoke tests** (must pass):
   - HTTP smoke: `/api/auth/me` returns expected role; core APIs return 200
   - Browser smoke (required): open key pages and ensure no client-side exceptions
     - `/pipeline` `/rules` `/match` `/upload` `/admin/config` `/lineage`
   - Optional E2E: upload a sample file and trigger import once

### Browser smoke automation (Playwright)
From `ui/`:
- Install once: `npm i` then `npx playwright install chromium`
- Run (recommended, no password needed): `npm run smoke:local-docker`
  - optional: `SMOKE_BASE_URL=http://localhost:3002` (default)
  - optional: `PG_CONTAINER=dataplatform-pg` (default)
- Run (fallback, UI login): `WDG_ADMIN_PASS=... npm run smoke:browser`

## 2) Publish to GitHub
Goal: create an auditable release unit.

- Push/merge to GitHub (with commit hash)
- Provide a short release note bundle:
  - commit hash
  - `bash scripts/run_change_guard.sh` result
  - local Docker smoke test result

## 3) VPS deploy (after explicit approval)
Goal: update production safely with minimal disruption.

Default method: **conservative sync** (avoid unnecessary container restarts).

- rsync/update only what changed: `scripts/` `sql/` `ui/` `docker-compose*.yml`
- apply safe SQL migrations (views/functions/tables); avoid destructive drops unless explicitly approved
- Metabase: run seed script if dashboards/cards changed
- UI: rebuild/restart UI container only if UI changed

## 4) VPS post-deploy verification
Goal: confirm the production surface is healthy.

Two smoke groups:

1) UI/API
- login OK
- key pages load
- key endpoints return 200

2) Metabase
- dashboards open
- key cards query successfully (or return expected async status)
