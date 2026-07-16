#!/bin/bash
# wdg-deploy.sh — pulled by systemd timer every 5 min
#
# Lives at /opt/wdg/deploy/systemd/wdg-deploy.sh (in the git working
# tree) so a `git pull` automatically picks up new versions of this
# script. The service unit at
# /etc/systemd/system/wdg-deploy.service points here via ExecStart.

set -euo pipefail

cd /opt/wdg

# Ensure RUNNER_USE_TOOL_RUNNER is not set to '0' — production uses the
# tool runner path (true streaming). Delete the line if found.
if grep -q '^RUNNER_USE_TOOL_RUNNER=0' /opt/wdg/.env 2>/dev/null; then
  echo "removing RUNNER_USE_TOOL_RUNNER=0 from .env (using tool runner streaming)"
  sed -i '/^RUNNER_USE_TOOL_RUNNER=0/d' /opt/wdg/.env
fi

# Save current HEAD so we can detect "Already up to date." and skip
# the (slow) npm ci + systemctl restart.
PREV_HEAD=$(git rev-parse HEAD)

# GIT_SSH_COMMAND is set in the unit file. For belt-and-suspenders,
# also export it here in case anyone runs the script by hand.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -i /root/.ssh/github_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new}"

git pull --ff-only
NEW_HEAD=$(git rev-parse HEAD)

if [ "$PREV_HEAD" = "$NEW_HEAD" ]; then
  # Self-heal: if a prior npm ci failure wiped node_modules but HEAD
  # hasn't moved since, the deploy timer would otherwise skip the
  # rebuild forever (dead-lock — process keeps running from RAM,
  # next /login hits MODULE_NOT_FOUND, /api/mcp 500s). Detect the
  # incomplete install and fall through to npm ci + build.
  if [ ! -x /opt/wdg/ui/node_modules/.bin/next ] || [ ! -d /opt/wdg/agent/node_modules ]; then
    echo "node_modules incomplete, running npm ci + build anyway"
  else
    echo "no new commits, skipping rebuild"
    exit 0
  fi
fi

# npm ci + tsc build run as www-data so files in /opt/wdg keep
# their owner (matching wdg-ui.service / wdg-agent.service).
sudo -u www-data -E bash <<'WWW_DATA_NPM'
set -euo pipefail
cd /opt/wdg/agent && npm ci --no-audit --no-fund && npm run build
cd /opt/wdg/ui    && npm ci --no-audit --no-fund && npm run build
WWW_DATA_NPM

# Restart all 5 application units via wdg.target. Runs as root since
# User=root in the unit, so no sudo needed.
systemctl restart wdg.target
systemctl status wdg.target --no-pager || true

echo "deployed $NEW_HEAD"
