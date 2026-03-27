#!/usr/bin/env bash
set -euo pipefail

# Lightweight, portable test oracle for WDG.
# - Always runs compileall (syntax sanity)
# - If core deps are installed, also smoke-test key script entrypoints (--help)
#   to catch import/runtime errors earlier than compileall.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[RUN] python3 -m compileall -q -x '/\\.venv/' ."
python3 -m compileall -q -x '/\.venv/' .

# Always sanity-check our stdlib-only harness scripts.
python3 scripts/record_root/drift_check.py --help >/dev/null
python3 scripts/record_root/log_guard.py --help >/dev/null

# Detect whether optional deps are present.
if python3 - <<'PY' >/dev/null 2>&1
import pandas, openpyxl, psycopg2  # noqa: F401
print('ok')
PY
then
  echo "[OK] deps present: running script entrypoint smoke tests"

  # These should not require a live DB when using --help.
  python3 scripts/import_bonjur_sales_daily.py --help >/dev/null
  python3 scripts/import_yufeng_bank_txn.py --help >/dev/null
  python3 scripts/run_pipeline_oneclick.py --help >/dev/null

  echo "[OK] selftest passed (deps + entrypoints)"
else
  echo "[WARN] deps not installed (pandas/openpyxl/psycopg2). Skipping optional entrypoint smoke tests."
  echo "[OK] selftest passed (compileall + harness scripts)"
fi
