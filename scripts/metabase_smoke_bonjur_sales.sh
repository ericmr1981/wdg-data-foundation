#!/usr/bin/env bash
# Smoke test for Bonjur Metabase artifacts.
# Verifies that the seeded cards can execute (catching "dashboard exists but queries fail").
#
# Usage:
#   export METABASE_URL=http://localhost:3001
#   export METABASE_API_KEY='...'
#   ./scripts/metabase_smoke_bonjur_sales.sh

set -euo pipefail

MB_URL="${METABASE_URL:-http://localhost:3001}"
MB_KEY="${METABASE_API_KEY:?METABASE_API_KEY is required}"

# Defaults (can override)
STORE_CODE="${BONJUR_STORE_CODE:-hz_in77}"

# Pick latest month available in dataplatform PG (local docker)
MONTH_DATE="${BONJUR_MONTH_DATE:-}"
if [[ -z "$MONTH_DATE" ]]; then
  # Prefer the main dev PG container; fall back to dashboard compose PG.
  PG_CONTAINER="dataplatform-pg"
  if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
    PG_CONTAINER="dataplatform-pg-dashboard"
  fi
  MONTH_DATE=$(docker exec -i "$PG_CONTAINER" psql -U postgres -d dataplatform -t -A -c "select to_char(max(month),'YYYY-MM-DD') from bonjur_dm.sales_monthly_report_v1;" | tr -d '[:space:]')
fi

if [[ -z "$MONTH_DATE" ]]; then
  echo "ERROR: could not determine MONTH_DATE" >&2
  exit 1
fi

echo "[INFO] METABASE_URL=$MB_URL"
echo "[INFO] MONTH_DATE=$MONTH_DATE STORE_CODE=$STORE_CODE"

# Get Bonjur card ids
CARD_IDS=$(curl -s -G -H "X-Api-Key: $MB_KEY" \
  --data-urlencode "q=Bonjur｜" \
  --data-urlencode "models=card" \
  "$MB_URL/api/search" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(" ".join(str(x.get("id")) for x in d.get("data",[]) if x.get("id")))')

if [[ -z "$CARD_IDS" ]]; then
  echo "ERROR: no Bonjur cards found (did you run the seed script?)" >&2
  exit 1
fi

echo "[INFO] card ids: $CARD_IDS"

for id in $CARD_IDS; do
  echo "[RUN] card $id"

  card_json=$(curl -s -H "X-Api-Key: $MB_KEY" "$MB_URL/api/card/$id")
  tags=$(echo "$card_json" | python3 -c 'import sys,json; c=json.load(sys.stdin);
q=c.get("dataset_query",{});
stages=q.get("stages") or [];
nt=(stages[0].get("template-tags") if stages and isinstance(stages[0],dict) else {}) or {};
print(" ".join(nt.keys()))')

  params_json=$(TAGS="$tags" MONTH_DATE="$MONTH_DATE" STORE_CODE="$STORE_CODE" python3 - <<'PY'
import json, os
MONTH_DATE=os.environ["MONTH_DATE"]
STORE_CODE=os.environ["STORE_CODE"]
tags=set(os.environ.get("TAGS","").split())
params=[]
if "month_date" in tags:
  params.append({"type":"date/single","target":["variable",["template-tag","month_date"]],"value":MONTH_DATE})
if "store_code" in tags:
  params.append({"type":"string/=","target":["variable",["template-tag","store_code"]],"value":STORE_CODE})
print(json.dumps({"parameters":params}))
PY
)

  TAGS="$tags" MONTH_DATE="$MONTH_DATE" STORE_CODE="$STORE_CODE" \
  curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $MB_KEY" \
    "$MB_URL/api/card/$id/query" \
    -d "$params_json" \
  | python3 -c 'import sys,json; o=json.load(sys.stdin);
# Normalize errors
err=o.get("error")
if err is None and isinstance(o.get("via"), list) and o["via"]:
    err=o["via"][0].get("message")
status=o.get("status")
rc=o.get("row_count")
if status is None and isinstance(o.get("data"), dict) and isinstance(o["data"].get("rows"), list):
    status="completed"
    rc=len(o["data"]["rows"])
print(f"  status={status} row_count={rc} error={err}")
if err or status != "completed":
    raise SystemExit(1)
'

done

echo "[OK] metabase bonjur smoke passed"
