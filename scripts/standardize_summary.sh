#!/usr/bin/env bash
set -euo pipefail

# Standardize Summary.md to the "pretty summary" template.
# Non-destructive by default: backup existing Summary.md.
#
# Usage:
#   bash standardize_summary.sh /path/to/project-record-root [--force]

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/project-record-root [--force]" >&2
  exit 2
fi

ROOT="$1"
shift || true
FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

ROOT="$(cd "$ROOT" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.harness-backup-$STAMP"

TEMPLATE="/Users/ericmr/.openclaw/agents/jarvis/workspace/skills/project-harness-guards/assets/templates/pretty_summary_template.md"
TARGET="$ROOT/Summary.md"

mkdir -p "$ROOT"

if [[ -f "$TARGET" && "$FORCE" -ne 1 ]]; then
  mkdir -p "$BACKUP_DIR"
  cp -a "$TARGET" "$BACKUP_DIR/" || true
  echo "backup: $BACKUP_DIR/Summary.md"
fi

# If not force and Summary exists, we still overwrite (because goal is standardization)
# BUT only after backup, so it is reversible.

cat "$TEMPLATE" > "$TARGET"
echo "written: $TARGET"

# Append a Change Log entry (best-effort) so log_guard doesn't immediately flag this standardization
PT="$ROOT/ProjectTasks.md"
NOW="$(date '+%Y-%m-%d %H:%M %Z')"
if [[ -f "$PT" ]]; then
  if ! grep -q "^## Change Log" "$PT"; then
    printf "\n## Change Log\n\n| Date | Change | Verification |\n|------|--------|--------------|\n" >> "$PT"
  fi
  if ! grep -q "^| Date | Change | Verification |" "$PT"; then
    printf "\n| Date | Change | Verification |\n|------|--------|--------------|\n" >> "$PT"
  fi
  printf "| %s | Standardize Summary.md to pretty summary template (oa-cli style) | Planned: run_change_guard.sh |\n" "$NOW" >> "$PT"
fi

echo "NOTE: Fill in placeholders (<...>) and keep this Summary verifiable + navigable."
