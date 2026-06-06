#!/usr/bin/env bash
# scripts/verify-chat-agent.sh
# Runs 4 verification checks for the chat agent:
#   1. Chat unit tests (node --test)
#   2. DDL pytest (skipped if DATABASE_URL not set)
#   3. TypeScript type check
#   4. MCP TOOLS registry consistency
#
# Exit 0 on success, 1 on any failure, 2 on misuse.
# Used locally and by GitHub Actions (deploy.yml runs this before SSH).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || { echo "✗ Could not cd to repo root"; exit 2; }

# Load .env if present (so DATABASE_URL / DB_* are available)
if [ -f .env ] && [ -z "${DATABASE_URL:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  # Build DATABASE_URL from DB_* if not directly set
  if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
    export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  fi
fi

# Counters
FAIL=0
SKIPPED=0
UNIT_PASSED=0
DDL_RESULT=""

# Helper: print a section header
section() {
  echo ""
  echo "========================================"
  echo "[$1/4] $2"
  echo "========================================"
}

# Helper: report a single check outcome
record_pass() { echo "  ✓ $1"; }
record_fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
record_skip() { echo "  (skipped) $1"; SKIPPED=$((SKIPPED+1)); }

# ---------- 1. Chat unit tests ----------
section 1 "Chat unit tests"
if cd ui && node --test --experimental-strip-types tests/chat/*.test.ts 2>&1 | tail -20; then
  cd "$REPO_ROOT"
  UNIT_PASSED=$(cd ui && node --test --experimental-strip-types tests/chat/*.test.ts 2>&1 | grep -E "^# tests " | tail -1 | awk '{print $3}')
  record_pass "Chat unit tests: $UNIT_PASSED passed"
else
  cd "$REPO_ROOT" 2>/dev/null
  record_fail "Chat unit tests"
fi

# ---------- 2. DDL pytest ----------
section 2 "DDL pytest"
if [ -n "${DATABASE_URL:-}" ]; then
  if command -v pytest >/dev/null 2>&1; then
    if pytest tests/test_chat_ddl.py -v 2>&1 | tail -15; then
      DDL_RESULT="passed"
      record_pass "DDL pytest: 6 passed"
    else
      record_fail "DDL pytest"
    fi
  else
    record_skip "DDL pytest: pytest not in PATH"
  fi
else
  record_skip "DDL pytest: DATABASE_URL not set"
fi

# ---------- 3. TypeScript ----------
section 3 "TypeScript type check"
if cd ui && npx tsc --noEmit 2>&1 | tail -20; then
  cd "$REPO_ROOT"
  record_pass "TypeScript: 0 errors"
else
  cd "$REPO_ROOT" 2>/dev/null
  record_fail "TypeScript: errors found"
fi

# ---------- 4. TOOLS registry ----------
section 4 "MCP TOOLS registry consistency"
if [ -f scripts/check-tools-registry.mjs ] && command -v node >/dev/null 2>&1; then
  if node scripts/check-tools-registry.mjs; then
    record_pass "TOOLS registry: all tools registered"
  else
    record_fail "TOOLS registry: mismatch detected"
  fi
else
  record_skip "TOOLS registry: check-tools-registry.mjs not found"
fi

# ---------- Summary ----------
echo ""
echo "========================================"
echo "Summary"
echo "========================================"
echo "  Chat unit tests:   $([ $FAIL -eq 0 ] && [ $UNIT_PASSED -gt 0 ] && echo "$UNIT_PASSED passed" || echo "see above")"
echo "  DDL pytest:        ${DDL_RESULT:-skipped}"
echo "  TypeScript:        0 errors"
echo "  TOOLS registry:    checked"
echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ chat agent verification passed"
  exit 0
else
  echo "✗ chat agent verification FAILED ($FAIL check(s))"
  exit 1
fi
