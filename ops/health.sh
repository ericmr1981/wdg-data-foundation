#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UI_PORT="${UI_PORT:-3002}"

code() {
  curl -s -o /dev/null -w "%{http_code}" "$1" || true
}

echo "[health] docker ps"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | egrep -i '(dataplatform|wdg|pg)' || true

echo

echo "[health] UI http://127.0.0.1:${UI_PORT} -> $(code "http://127.0.0.1:${UI_PORT}")"
