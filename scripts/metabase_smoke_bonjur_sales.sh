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
STORE_CODE="${BONJUR_STORE_CODE:-wz_oh_wxc}"

# Pick latest month available in dataplatform PG (local docker)
MONTH_DATE="${BONJUR_MONTH_DATE:-}"
if [[ -z "$MONTH_DATE" ]]; then
  MONTH_DATE=$(docker exec -i dataplatform-pg psql -U postgres -d dataplatform -t -A -c "select to_char(max(month),'YYYY-MM-DD') from bonjur_dm.sales_monthly_report_v1;" | tr -d '[:space:]')
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

payload=$(cat <<JSON
{
  "parameters": [
    {"type": "date/single", "target": ["variable", ["template-tag", "month_date"]], "value": "$MONTH_DATE"},
    {"type": "string/=", "target": ["variable", ["template-tag", "store_code"]], "value": "$STORE_CODE"}
  ]
}
JSON
)

for id in $CARD_IDS; do
  echo "[RUN] card $id"
  curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $MB_KEY" \
    "$MB_URL/api/card/$id/query" \
    -d "$payload" \
  | python3 -c 'import sys,json; o=json.load(sys.stdin);
status=o.get("status");
err=o.get("error");
rc=o.get("row_count");
print(f"  status={status} row_count={rc} error={err}");
raise SystemExit(0 if status=="completed" else 1)'

done

echo "[OK] metabase bonjur smoke passed"
