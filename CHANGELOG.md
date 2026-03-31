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

## 2026-03-31 13:00
- goal: 新品牌 gelatomiiix（蜜可诗）上线后端到端验收 + 修复初始化完整性 bug
- bug-1: ops.fn_log_bank_rule_map_change() 函数不存在 → 品牌创建时报错
  - fix: VPS上手动创建 ops schema + 函数 + 触发器（sql/rules_history.sql 从未被 apply）
  - commit: local only（VPS direct）
- bug-2: import_yufeng_bank_txn.py 硬编码 `{brand_code}_ods` → 新品牌 schema 命名不一致
  - fix: 新增 get_ods_schema() / get_dm_schema() 与 TypeScript API 对齐
  - commit: 941f843
- bug-3: init-bank-template API 漏掉 snapshot 表 + expense/profit 视图
  - fix: 补充 yufeng_classification_snapshot.sql + yufeng_dm_models.sql
  - fix: 补加 sqlSnapshot 变量声明（TypeScript 编译错误）
  - commit: 011a958（forced push）
  - VPS 已部署新镜像 wdg-ui:latest
- gelatomiiix VPS 数据库补建:
  - brand_gelatomiiix_dm.bank_txn_classified_snapshot 表（含主键约束）
  - brand_gelatomiiix_dm.refresh_bank_txn_classified_snapshot() 函数
- decision: keep
- guard: docker build ✅ + tsc compile ✅
- next: 在 UI 重新上传蜜可诗银行数据，验证完整链路（import → 分类 → BI 报表）
