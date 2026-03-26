#!/usr/bin/env bash
set -euo pipefail

# Minimal, idempotent bootstrap for WDG.
# Goal: provide a reliable oracle entrypoint without flooding the main context.
#
# By default we avoid network installs. If you need deps installed, run with:
#   INSTALL_DEPS=1 bash init.sh

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
python -V

if [[ "${INSTALL_DEPS:-0}" == "1" ]]; then
  python -m pip install -U pip
  python -m pip install -r requirements.txt
fi

# Always run a tiny oracle to ensure the tree is at least syntactically valid.
# Exclude local venv + generated folders to avoid noise.
python -m compileall -q -x '/\\.venv/' .
