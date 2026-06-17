# wdg-deploy.timer — auto-pull latest `main` and restart

This systemd timer replaces the previous docker-era "GitHub Actions
build → ACR push → VPS cron pull" loop, and the later
GitHub Actions SSH-based deploy.

## Mechanism

`wdg-deploy.timer` triggers `wdg-deploy.service` every 5 minutes:

1. `git pull --ff-only` from origin/main
2. If HEAD changed, rebuild agent (`npm ci` + `npm run build`)
3. `npm ci` in ui/ (UI runs `npm run dev` so no build step)
4. `systemctl restart wdg.target` (all 5 app units)
5. Print the new HEAD SHA

## Install on VPS

```bash
# Copy the unit + timer. The deploy logic is in deploy/systemd/wdg-deploy.sh
# inside the git working tree, so a `git pull` automatically picks up
# script updates. The unit just points to it via ExecStart.
sudo cp /opt/wdg/deploy/systemd/wdg-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wdg-deploy.timer

# Verify
systemctl list-timers wdg-deploy.timer
journalctl -u wdg-deploy.service -f   # watch the next 5-min run
```

## Manual trigger

```bash
sudo systemctl start wdg-deploy.service
journalctl -u wdg-deploy.service -n 50
```

## Stop auto-deploy

```bash
sudo systemctl disable --now wdg-deploy.timer
```

## Notes

- Service runs as **root** because only root has the
  `github_deploy` SSH key with read access to the GitHub repo
  (`www-data` does not). The `git pull` step runs as root directly.
  For `npm ci` / `npm run build` the service drops to `www-data`
  via `sudo -u www-data` so files in `/opt/wdg` keep their owner.
- The `GIT_SSH_COMMAND` env var forces ssh to use
  `/root/.ssh/github_deploy` with `IdentitiesOnly=yes` — without it,
  SSH would try `github_account_ed25519` (bound to github.com in
  `/root/.ssh/config` for a different repo) and the pull would fail
  with "repository not found".
- `git pull --ff-only` is a hard requirement — if main has been
  force-pushed or rewound, the timer will fail with "non-fast-forward
  update" and the operator must intervene.
- Agent rebuild is the slowest step (~30-60s for `npm ci` + `tsc`).
  Other steps are sub-second.
- Delay from `git push` to deploy is **5 minutes + drift** (worst
  case ~5.5 min). For urgent deploys use `systemctl start wdg-deploy.service`
  manually.
