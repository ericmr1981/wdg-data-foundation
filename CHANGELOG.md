# Progress Log

## 2026-03-30 13:00
- goal: WDG architecture refactoring to P2 (security + testability)
- bet: T-001 — Login brute-force protection
  - ops.login_attempts table (IP, username, success, user_id)
  - 5 failed / 5 min → 429 + Retry-After header
  - No user-enumeration: same error for bad user or bad password
  - 30-day cleanup function
- commit: a14ba9c
- verification:
  - command: cd ui && npx tsc --noEmit
  - result: pass
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
- next: T-002 — upload file-type validation

## 2026-03-27 16:12
- goal: Fix Metabase「支出一级分类趋势」图表轴识别错误（X/Y 对调）
- bet: Seed 时显式指定 X=月份、Y=金额(元)、series=一级分类，避免 Metabase 自动推断
- commit: HEAD
- verification:
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep

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
