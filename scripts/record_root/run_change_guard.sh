#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/project-record-root" >&2
  exit 2
fi

ROOT="$1"

echo "== drift_check =="
python3 "$DIR/drift_check.py" "$ROOT" || exit $?

echo

echo "== log_guard =="
python3 "$DIR/log_guard.py" "$ROOT" || exit $?
