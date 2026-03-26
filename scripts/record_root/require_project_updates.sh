#!/usr/bin/env bash
set -euo pipefail

# Git gate: if staged changes include code/config/scripts, ProjectTasks.md must also be staged.
# Exit: 0 OK, 2 RISK

if ! command -v git >/dev/null 2>&1; then
  echo "RISK: git not found"
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "INFO: not a git repo; skip"
  exit 0
fi

changed="$(git diff --name-only --cached)"
if [[ -z "$changed" ]]; then
  echo "INFO: no staged changes"
  exit 0
fi

needs_docs=0
echo "$changed" | grep -E '\.(py|ts|js|yaml|yml)$|^scripts/|^cron/' >/dev/null && needs_docs=1 || true

if [[ "$needs_docs" == "1" ]]; then
  echo "$changed" | grep -E '(^|/)ProjectTasks\.md$' >/dev/null || {
    echo "RISK: code/config/scripts changed but ProjectTasks.md not staged"
    exit 2
  }
fi

echo "OK"
