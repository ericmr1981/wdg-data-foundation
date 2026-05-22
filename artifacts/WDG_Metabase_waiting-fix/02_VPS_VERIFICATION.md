# VPS Verification Checklist — Metabase "Waiting for Results" Fix

## Pre-flight
```bash
# SSH to VPS
ssh root@112.124.18.246

# Check what compose file is in use
cd /root/wdg-data-foundation
docker-compose -f docker-compose.yml ps 2>/dev/null || \
docker -compose -f docker-compose.dashboard.yml ps 2>/dev/null || \
echo "UNABLE TO FIND RUNNING COMPOSE"
```

---

## Step 1: Verify Metabase Port (8081 vs 8082)

**Check what port Metabase is actually listening on:**
```bash
# Option A: docker ps ports
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep metabase

# Expected output should show 0.0.0.0:8082->3000/tcp (NOT 8081)
# If you see 8081: fix is needed (see Step 3 below)

# Option B: curl the health endpoint on both ports
curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/api/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:8082/api/health

# Expected: 8081 -> 404 or redirect (wrong site-url), 8082 -> 200
```

**If Metabase is on 8081:**
```bash
# Check .env for METABASE_PORT
grep METABASE_PORT /root/wdg-data-foundation/.env

# Fix: set METABASE_PORT=8082 and restart
echo "METABASE_PORT=8082" >> /root/wdg-data-foundation/.env
docker-compose -f docker-compose.yml restart metabase
# OR (if using dashboard compose):
docker-compose -f docker-compose.dashboard.yml restart metabase
```

---

## Step 2: Verify site-url Setting

**Check current site-url via API:**
```bash
METABASE_URL="http://localhost:8082"
API_KEY="..."  # from .env METABASE_API_KEY

curl -s -H "X-Api-Key: $API_KEY" \
  "$METABASE_URL/api/setting/site-url" | python3 -m json.tool

# Expected: "http://112.124.18.246:8082"
# If shows 8081: fix needed
```

**Fix site-url if wrong:**
```bash
curl -s -X PUT \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value": "http://112.124.18.246:8082"}' \
  "$METABASE_URL/api/setting/site-url"
```

---

## Step 3: Verify Month Filter Has Values (Dashboard Parameters)

**Check Dashboard 8 (gelatomiiix) Month parameter:**
```bash
METABASE_URL="http://localhost:8082"
API_KEY="..."
DASH_ID=8

curl -s -H "X-Api-Key: $API_KEY" \
  "$METABASE_URL/api/dashboard/$DASH_ID" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
for p in d.get('parameters', []):
    if p.get('slug') == 'month_date':
        print('Month param:', json.dumps(p, indent=2))
"

# Expected: should have values_source_type='static-list' and values_source_config with values
# If values_source_config is empty or missing: the seed script fix needs to be re-run
```

---

## Step 4: Run Seed Script to Re-apply Month Values (if needed)

```bash
cd /root/wdg-data-foundation

# Set environment
export METABASE_URL="http://localhost:8082"
export METABASE_API_KEY="..."  # from .env

# Re-seed each brand dashboard
python3 scripts/metabase_seed_dashboard.py --brand gelatomiiix
python3 scripts/metabase_seed_dashboard.py --brand yufeng
python3 scripts/metabase_seed_dashboard.py --brand bonjur

# Also re-seed bonjur ops dashboard
python3 scripts/metabase_seed_bonjur_ops_dashboard.py

# Expected: no errors, should print "Brand: X (Y)" and create/update dashboards
```

---

## Step 5: Verify DB Schema Views Exist (gelatomiiix / bonjur)

```bash
docker exec dataplatform-pg-dashboard psql -U postgres -d dataplatform -c "
SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '%gelatomiiix%' OR schema_name LIKE '%bonjur%';
"

# Expected: should show brand_gelatomiiix_dm, brand_gelatomiiix_ods, bonjur_dm, bonjur_ods, etc.

# Check key DM views
docker exec dataplatform-pg-dashboard psql -U postgres -d dataplatform -c "
SELECT COUNT(*) FROM brand_gelatomiiix_dm.profit_monthly;
SELECT COUNT(*) FROM brand_gelatomiiix_dm.v_bank_txn_classified;
"
```

---

## Step 6: Live Dashboard Acceptance Test

**Open in browser (or curl):**
```bash
# Dashboard 8 (gelatomiiix)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8082/dashboard/8"
# Dashboard 9 (yufeng)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8082/dashboard/9"
# Dashboard 10 (bonjur)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8082/dashboard/10"
```

**Expected:** All return 200 (not 401/302/500).

**Browser test:**
1. Open http://112.124.18.246:8082/dashboard/8
2. Wait 30 seconds — cards should load (not spin forever)
3. Click a Month filter — should show month options (not empty)
4. Cards should show data (not "No results" or "Waiting for results...")

---

## Reproduce Original Symptom

```bash
# To simulate the old broken state:
# 1. Set site-url to 8081 (wrong):
curl -s -X PUT -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"value": "http://112.124.18.246:8081"}' \
  "$METABASE_URL/api/setting/site-url"

# 2. Open dashboard — should see API 401 errors in browser dev tools
# 3. Restore correct site-url:
curl -s -X PUT -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"value": "http://112.124.18.246:8082"}' \
  "$METABASE_URL/api/setting/site-url"
```

---

## Docker Logs for Diagnosis

```bash
# Metabase container logs (last 100 lines)
docker logs dataplatform-metabase --tail=100

# Look for:
# - "Connection refused" (DB connectivity)
# - "Statement timeout" (query too slow)
# - "null" parameters (filter issue)

# Postgres logs
docker logs dataplatform-pg-dashboard --tail=50
```
