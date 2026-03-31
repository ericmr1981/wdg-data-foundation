# Progress Log

## 2026-03-30 13:00
- goal: WDG architecture refactoring to P2 (security + testability)
- T-001: Login brute-force protection
  - ops.login_attempts table + IP lockout (5 failed / 5 min → 429)
  - commit: a14ba9c
  - verification: cd ui && npx tsc --noEmit → pass
- T-002: Upload file-type whitelist (.xlsx/.csv only)
  - commit: 2b66978
  - verification: cd ui && npx tsc --noEmit → pass
- T-003: ETL pipeline step rollback on exception
  - ops_logger.py step_end(rollback=True) + _rollback_started_steps()
  - commit: 201bd14
  - verification: py_compile + compileall → pass
- T-004: Schema whitelist validation
  - ops.allowed_schemas table + isAllowedSchema() + getDmSchemaSafe()
  - Integrated into /api/coverage routes
  - commit: 42effc3
  - verification: cd ui && npx tsc --noEmit → pass
- T-005: Classification rules JSON-ized + pytest
  - rules/yufeng_bank_rules.json (111 rules, version=v2)
  - scripts/classify.py (pure-Python, mirrors SQL fn_classify_v2)
  - tests/test_classify.py (16 pytest cases, 16/16 ✅)
  - harness.json: testCommand now runs pytest
  - commit: dd8ed86
- decision: keep
- guard: compileall + pytest 16/16 ✅
- next: deploy DDL changes to staging/prod (ops.login_attempts + ops.allowed_schemas)

## 2026-03-27 16:12
- goal: Fix Metabase「支出一级分类趋势」图表轴识别错误（X/Y 对调）
- bet: Seed 时显式指定 X=月份、Y=金额(元)、series=一级分类，避免 Metabase 自动推断
- commit: HEAD
- verification:
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep

## 2026-03-26 22:15
- goal: Merge harness branch into main
- bet: Merge repo-first harness baseline
- commit: 6cf171c
- verification:
  - command: bash scripts/run_change_guard.sh
  - result: pass
- decision: keep
