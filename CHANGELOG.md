# Progress Log

## 2026-03-31 18:35
- goal: 方案 A — metabase_seed_dashboard.py 支持 --brand 参数，多品牌自动生成报表
- bet: 改造脚本支持动态品牌参数（yufeng/bonjur/gelatomiiix 等）
- changes:
  - scripts/metabase_seed_dashboard.py: 新增 --brand 和 --dashboard-name 参数
  - 新增 sql_for_brand() 函数，自动替换 schema 前缀（yufeng_* → {brand}_*）
  - 所有 Card/Dashboard 名称改为动态生成（f"{BRAND_DISPLAY}｜..."）
  - HEADERS 初始化移至 main()，支持 --help 不连接 Metabase
  - 修复 dashboard 名称重复问题（移除重复的 dash_name 赋值）
- commit: d1c2295 + 7df2336
- verification:
  - command: python3 -m py_compile scripts/metabase_seed_dashboard.py && python3 scripts/metabase_seed_dashboard.py --help
  - result: pass (--help 正常显示，语法检查通过)
  - L2: VPS 生成了 gelatomiiix dashboard (id=8) → http://112.124.18.246:8082/dashboard/8
- decision: keep
- guard: py_compile ✅ + VPS 验证 ✅
- next: 在 VPS 浏览器验证 dashboard 数据正确性；支持 bonjur 品牌

## 2026-03-31 19:15
- goal: 修复 gelatomiiix Metabase dashboard 数据刷不出来
- bug: dashboard 一直 loading（Waiting for results...）
- root-cause: brand_gelatomiiix_dm 缺少 3 个关键视图（revenue_monthly, expense_monthly, profit_monthly）
- fix:
  - 创建 sql/gelatomiiix_dm_models.sql（从 yufeng_dm_models.sql 派生）
  - VPS apply 成功：4 个视图创建完成
  - 验证：profit_monthly 返回数据（2025-08: profit_amt=19653.92）
- commit: pending
- verification: SELECT * FROM brand_gelatomiiix_dm.profit_monthly → 2 rows ✅
- decision: keep
- next: 在 Metabase 刷新 dashboard 确认显示正常

## 2026-03-31 19:25
- goal: 修复所有品牌 Metabase dashboard 卡在"等待中"
- root-causes:
  1. gelatomiiix/bonjur 缺少 DM 视图（revenue_monthly, expense_monthly, profit_monthly）
  2. sql_for_brand() 不支持 "brand_{brand}_*" schema 前缀模式
  3. Card SQL 引用了 c.lvl1/c.lvl2 兼容列（gelatomiiix 视图没有这些列）
- fixes:
  - sql_for_brand(): 支持 "brand_{brand}_*" 模式（gelatomiiix 等）
  - 移除所有 c.lvl1/c.lvl2 引用，改用 c.lvl1_name/c.lvl2_name
  - 创建 sql/gelatomiiix_dm_models.sql + sql/bonjur_dm_models.sql
  - VPS apply 成功：所有品牌 DM 视图创建完成
- verification:
  - yufeng Card 83: 17 rows ✅
  - gelatomiiix Card 74: 17 rows ✅
  - bonjur Card 92: 17 rows ✅
- dashboards:
  - yufeng: http://112.124.18.246:8082/dashboard/9
  - gelatomiiix: http://112.124.18.246:8082/dashboard/8
  - bonjur: http://112.124.18.246:8082/dashboard/10

## 2026-03-31 19:50
- goal: 修复 Metabase dashboard 查询慢（数据计算量太大）
- root-cause: `v_bank_txn_classified_v2` 视图定义错误 — `fn_classify_bank_txn_v2()` 函数被调用 7 次/每条记录
  - 原始定义：在 SELECT 中调用 4 次 + JOIN 条件中调用 3 次
  - 48 条流水 × 7 次 = 336 次函数执行，每次还要查规则表
  - 性能：v_bank_txn_classified = 676ms, profit_monthly = 1457ms
- fix: 用 LATERAL JOIN 重构视图（函数只调用 1 次/每条记录）
  - sql/gelatomiiix_fix_classified_view.sql
  - CROSS JOIN LATERAL (SELECT fn_classify_bank_txn_v2(t.id).*) c
  - 性能：v_bank_txn_classified = 47ms (↓14x), profit_monthly = 75ms (↓19x)
- verification:
  - Card 74: 149ms (17 rows) ✅
  - Card 75: 37ms (5 rows) ✅
  - Card 78: 60ms (2 rows) ✅
- decision: keep
- next: bonjur 也需要同样修复

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
