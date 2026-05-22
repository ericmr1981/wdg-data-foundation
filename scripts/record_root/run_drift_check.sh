#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/project-record-root [--json]" >&2
  exit 2
fi

ROOT="$1"
shift || true

if [[ "${1:-}" == "--json" ]]; then
  python3 "$DIR/drift_check.py" "$ROOT" --json
  exit $?
fi

python3 "$DIR/drift_check.py" "$ROOT"
