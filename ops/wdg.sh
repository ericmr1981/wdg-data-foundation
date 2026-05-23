#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
if [ ! -f "$COMPOSE_FILE" ]; then
  COMPOSE_FILE="docker-compose.dashboard.yml"
fi

DC=(docker-compose -f "$COMPOSE_FILE")

usage() {
  cat <<USAGE
Usage: ops/wdg.sh <cmd>

cmd:
  up [svc...]        docker-compose up -d --remove-orphans
  build [svc...]     docker-compose build
  pull [svc...]      docker-compose pull
  ps                docker-compose ps
  logs [svc...]      docker-compose logs -f --tail=200
  restart [svc...]   docker-compose restart
  down               docker-compose down
  config             docker-compose config

Env:
  COMPOSE_FILE=<path>  (default: docker-compose.yml; fallback: docker-compose.dashboard.yml)
USAGE
}

cmd="${1:-}"
shift || true

case "$cmd" in
  up)      "${DC[@]}" up -d --remove-orphans "$@" ;;
  build)   "${DC[@]}" build "$@" ;;
  pull)    "${DC[@]}" pull "$@" ;;
  ps)      "${DC[@]}" ps ;;
  logs)    "${DC[@]}" logs -f --tail=200 "$@" ;;
  restart) "${DC[@]}" restart "$@" ;;
  down)    "${DC[@]}" down "$@" ;;
  config)  "${DC[@]}" config ;;
  *)       usage; exit 1 ;;
 esac
