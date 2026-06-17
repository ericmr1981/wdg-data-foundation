#!/bin/bash
# wdg-deploy.sh — pulled by systemd timer every 5 min
#
# Lives at /opt/wdg/deploy/systemd/wdg-deploy.sh (in the git working
# tree) so a `git pull` automatically picks up new versions of this
# script. The service unit at
# /etc/systemd/system/wdg-deploy.service points here via ExecStart.

set -euo pipefail

cd /opt/wdg

# Save current HEAD so we can detect "Already up to date." and skip
# the (slow) npm ci + systemctl restart.
PREV_HEAD=$(git rev-parse HEAD)

# GIT_SSH_COMMAND is set in the unit file. For belt-and-suspenders,
# also export it here in case anyone runs the script by hand.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -i /root/.ssh/github_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new}"

git pull --ff-only
NEW_HEAD=$(git rev-parse HEAD)

if [ "$PREV_HEAD" = "$NEW_HEAD" ]; then
  echo "no new commits, skipping rebuild"
  exit 0
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
