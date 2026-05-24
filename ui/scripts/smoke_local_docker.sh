#!/usr/bin/env bash
set -euo pipefail

# Browser smoke runner for the local Docker UI.
# - Creates a fresh admin session token in the local Postgres container
# - Runs Playwright smoke with WDG_SESSION_TOKEN (no password needed)

BASE_URL="${SMOKE_BASE_URL:-http://localhost:3002}"
PG_CONTAINER="${PG_CONTAINER:-dataplatform-pg}"
DB_NAME="${DB_NAME:-dataplatform}"
DB_USER="${DB_USER:-postgres}"

# WDG local default admin user_id (existing seeded admin).
ADMIN_ID="${WDG_ADMIN_ID:-4f5e23e8-17e6-4060-a47b-a978392f1938}"

TOKEN=$(python3 - <<'PY'
import uuid
print(uuid.uuid4().hex)
PY
)

echo "[smoke] base=${BASE_URL}"
echo "[smoke] pg_container=${PG_CONTAINER}"
echo "[smoke] admin_id=${ADMIN_ID}"
echo "[smoke] token=${TOKEN:0:8}…"

# Create session (7 days)
docker exec -i "${PG_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 \
  -c "insert into ops.sessions (token, user_id, expires_at) values ('${TOKEN}', '${ADMIN_ID}'::uuid, now() + interval '7 days');" \
  >/dev/null

export SMOKE_BASE_URL="${BASE_URL}"
export WDG_SESSION_TOKEN="${TOKEN}"

# Ensure browsers exist (best-effort)
if ! npx playwright -q --version >/dev/null 2>&1; then
  echo "[smoke] Playwright not installed. Run: npm i"
  exit 2
fi

npm run smoke:browser
