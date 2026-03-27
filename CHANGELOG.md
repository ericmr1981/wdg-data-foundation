# Progress Log

## 2026-03-27 14:20
- goal: Upload 回执补全（返回 source_file_id / 导入状态）+ 新增品牌/门店体验收口
- bet: /api/upload 计算文件 sha256 并回读 raw.ingest_file（best-effort）；Brand 下拉在当前 brand 不可用时自动切换到第一个可用品牌
- commit: HEAD
- verification:
  - command: (ui) npm run build
  - result: pass (Next build ok)
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
- next: 需要的话把 /api/upload 的回执信息（status/row_count/error_message）同步展示到更多页面（比如 lineage）

## 2026-03-27 08:55
- goal: Reduce harness drift-check noise while keeping progress logging useful
- bet: Allow progress log to reference the current commit symbolically (commit: HEAD)
- commit: HEAD
- verification:
  - command: bash scripts/run_drift_check.sh
  - result: pass
- decision: keep
- next: n/a

## 2026-03-27 08:45
- goal: Add a more meaningful, portable test oracle (beyond compileall)
- bet: Introduce a lightweight selftest that always runs compileall + harness-script smoke, and optionally runs key script entrypoints when deps are installed
- commit: 4202da3
- verification:
  - command: bash scripts/selftest.sh
  - result: pass (deps missing → optional entrypoint smoke skipped)
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
- next: If we want stricter checks, add a DB-backed integration test profile (docker compose + SQL apply) as e2eCommand

## 2026-03-27 (earlier)
- goal: Data lineage admin UI (lineage V3 overlay + drilldown)
- bet: Add lineage page + related secured APIs
- commit: 5ef5b33
- verification:
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
- next: Decide whether to merge feat/ui-lineage to main and whether lineage should be enabled by default or behind admin flag

## 2026-03-26 22:10
- goal: Install repo-first harness (Trinity) and avoid record-root guard name collisions
- bet: Move legacy record-root governance scripts under `scripts/record_root`; scaffold repo-first harness at repo root
- commit: 18ced46
- verification:
  - command: bash init.sh
  - result: pass (compileall excluding .venv)
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
- next: Define a real test oracle (pytest/integration) and set `harness.json:testCommand` accordingly

## 2026-03-26 22:15
- goal: Merge harness branch into main
- bet: Merge repo-first harness baseline
- commit: 6cf171c
- verification:
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
- next: Keep improving real test oracle beyond compileall
