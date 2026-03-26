# Record-root (Obsidian-style) governance scripts

This folder contains the **external record-root** governance tooling (Map/ProjectTasks/Summary, drift/log guards).

It was moved here to avoid name conflicts with the **repo-first harness guards**:
- `scripts/run_drift_check.sh`
- `scripts/run_change_guard.sh`

Repo-first guards live at `scripts/run_*.sh`.

If you maintain an external record root (e.g. Obsidian project dir), you can still run:
- `bash scripts/record_root/run_change_guard.sh <record-root>`
