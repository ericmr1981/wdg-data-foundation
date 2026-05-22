#!/usr/bin/env bash
set -euo pipefail

# Upgrade an existing Obsidian project record directory to the harness-guards standard.
# Non-destructive: creates a timestamped backup folder inside the project root.
#
# Usage:
#   bash upgrade_existing_project.sh /path/to/project-record-root

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/project-record-root" >&2
  exit 2
fi

ROOT="$1"
mkdir -p "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.harness-backup-$STAMP"
mkdir -p "$BACKUP_DIR"

echo "== project-harness-guards: upgrade existing project =="
echo "root:   $ROOT"
echo "backup: $BACKUP_DIR"

default_if_missing() {
  local path="$1"
  shift
  if [[ ! -f "$path" ]]; then
    cat > "$path" <<EOF
$*
EOF
    echo "created: $path"
  else
    echo "kept:    $path"
  fi
}

backup_if_exists() {
  local path="$1"
  if [[ -f "$path" ]]; then
    cp -a "$path" "$BACKUP_DIR/" || true
  fi
}

# Backup key docs if they exist
for f in Map.md ProjectTasks.md Summary.md Readme.md Invariants.md Harness_DoD.md Runbook.md Doc_Gardening.md; do
  backup_if_exists "$ROOT/$f"
done

# Ensure minimum required docs exist
default_if_missing "$ROOT/Map.md" "# Project Map\n\n- Goal:\n- Key paths:\n- How to verify:\n- Guard commands:\n  - bash scripts/run_change_guard.sh\n"

default_if_missing "$ROOT/ProjectTasks.md" "# ProjectTasks\n\n## Tasks\n\n## Acceptance / DoD\n\n## Change Log\n\n| Date | Change | Verification |\n|------|--------|--------------|\n"

default_if_missing "$ROOT/Summary.md" "# <ProjectName> — Summary\n\n> 建议使用 project-harness-guards 的 pretty summary 模板（类似 oa-cli 项目的 Summary）。\n> 可运行：`bash scripts/standardize_summary.sh \".\"`\n\n## 📋 项目概述\n\n(一句话 + 核心价值 + 当前状态)\n"

default_if_missing "$ROOT/Readme.md" "# Readme\n\nThis directory is the single source of truth for project status, decisions, verification, and links.\n\nStart here: Map.md\n"

# Recommended harness set (create if missing)
default_if_missing "$ROOT/Invariants.md" "# Invariants\n\n- Non-negotiable rules.\n"

default_if_missing "$ROOT/Harness_DoD.md" "# Harness DoD\n\n- Any change must update ProjectTasks change log with: what changed + verification method + result.\n- Preferred (non-PR/direct-edit): bash scripts/run_change_guard.sh\n- Minimum: bash scripts/run_drift_check.sh\n"

default_if_missing "$ROOT/Runbook.md" "# Runbook\n\n- SOP for triage/repair.\n"

default_if_missing "$ROOT/Doc_Gardening.md" "# Doc Gardening\n\n- Any change must run guards.\n"

# Install/refresh guards under the project root
mkdir -p "$ROOT/scripts"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

for f in drift_check.py log_guard.py run_drift_check.sh run_change_guard.sh require_project_updates.sh upgrade_existing_project.sh standardize_summary.sh; do
  install -m 755 "$SRC_DIR/$f" "$ROOT/scripts/$f"
done

# Record this standardization as a project change (so log_guard doesn't flag the upgrade itself)
NOW="$(date '+%Y-%m-%d %H:%M %Z')"
PT="$ROOT/ProjectTasks.md"
if [[ -f "$PT" ]]; then
  # Ensure there is at least a Change Log table; if not present, append a minimal one.
  if ! grep -q "^## Change Log" "$PT"; then
    printf "\n## Change Log\n\n| Date | Change | Verification |\n|------|--------|--------------|\n" >> "$PT"
  fi
  if ! grep -q "^| Date | Change | Verification |" "$PT"; then
    # Try to append a table header if it's missing
    printf "\n| Date | Change | Verification |\n|------|--------|--------------|\n" >> "$PT"
  fi
  printf "| %s | Standardize project to harness-guards (install/refresh scripts + docs) | Planned: run_change_guard.sh |\n" "$NOW" >> "$PT"
fi

echo

echo "== run guards (recommended) =="
set +e
bash "$ROOT/scripts/run_change_guard.sh" "$ROOT"
rc=$?
set -e

if [[ $rc -ne 0 ]]; then
  echo "\nRISK: guard failed (exit=$rc). Fix issues or record explicit risk acceptance in ProjectTasks.md."
  exit $rc
fi

echo "\nOK: project upgraded to harness-guards standard"
