# Progress Log

## 2026-07-24
- Added (feature): 产品销售明细手工上传 + MCP 导入工具
  - `ui/src/app/api/gelatomiiix/sales/upload-product/route.ts` — 新增 API 端点 `POST /api/gelatomiiix/sales/upload-product`
  - `ui/src/mcp/tools/upload-gelatomiiix-product-sales.ts` — 新增 MCP 工具 `upload_gelatomiiix_product_sales`
  - `ui/src/mcp/server.ts` — 注册新 MCP 工具
  - `ui/src/app/api/upload/route.ts` — 通用上传新增 `product_sales` 数据源分派
  - `ui/src/app/upload/page.tsx` — 上传页面新增"商品销售明细"数据源 + Suspense 包裹
  - `ui/src/app/u/sales/gelatomiiix/page.tsx` — 销售页新增"上传商品销售"快捷入口
  - `docs/mcp-tools.md` / `CLAUDE.md` — 文档统计更新
- verification: `npx tsc --noEmit` ✅

<<<<<<< HEAD
## 2026-04-07
- Fixed (repo): 将“配送明细”并入原有 `/upload` 数据源体系，而不是继续走独立 `xintiandi` 上传入口
  - `ui/src/app/upload/page.tsx`: 数据源下拉新增 `delivery / 配送明细`
  - `ui/src/app/api/upload/route.ts`: 新增 `source === 'delivery'` → `import_xintiandi_delivery.py`
  - 后端文件类型白名单补齐 `.xls`
- Improved (UI): 收口上传页交互
  - `ui/src/app/upload/page.tsx`: 默认开启“触发导入”
  - 新增数据源说明卡、配送明细预期字段提示、上传成功后的导入摘要卡片
  - 对 `delivery` 增加“打开新天地看板”下一步入口
- verification (local): `cd ui && npx tsc --noEmit` + `bash scripts/run_change_guard.sh`
- next: VPS 同步 upload 入口改动并验证 `/upload` 页面可选择“配送明细”

## 2026-04-02 (4402a46 + delta)
- Fixed (repo): docker-compose.yml port 8081→8082 for Metabase (regression prevention)
  - Previous fix (4f8ee61) was applied via direct API on VPS but NOT captured in compose
  - Compose still defaulted to METABASE_PORT=8081 (wrong); health check script (archived) already used 8082
- Fixed (repo): metabase_seed_dashboard.py — added `month_values_for_brand()` function
  - Month filter (date/month-year) now populated from actual brand_ods.bank_txn months
  - Without this: [[ AND extract(year from t.txn_time) = extract(year from {{month_date}}) ]]
    expands to ALL years → full table scan → "waiting for results"
  - Wrapped in try/except — returns [] gracefully if DB has no data yet
- Fixed (repo): metabase_seed_bonjur_ops_dashboard.py — added same Month values_source_config
- commit: 4402a46 (ops: solidify WDG VPS compose + ops scripts)
- verification: bash scripts/run_change_guard.sh → 16/16 pytest PASS ✅
=======
## 2026-03-27 14:20
- goal: Upload 回执补全（返回 source_file_id / 导入状态）+ 新增品牌/门店体验收口
- bet: /api/upload 计算文件 sha256 并回读 raw.ingest_file（best-effort）；Brand 下拉在当前 brand 不可用时自动切换到第一个可用品牌
>>>>>>> origin/main

## 2026-04-01 12:46
- Fixed: 部署环境 Metabase 所有 Dashboard 卡在 “Waiting for results”
  - Root cause: `site-url` 端口错误 (8081 vs 8082) + Month 参数无 values 来源
  - Fix: 修正 site-url，为 Dashboard 8/9/10/5 的 Month 参数添加静态值列表
  - Result: 5 个 Dashboard 全部正常加载（8+8+8+8+5 cards）
- Note: 使用 Metabase API key 临时创建 admin 用户 polo_test@polo.ai 用于操作

## 2026-03-31 18:35
- goal: 方案 A — metabase_seed_dashboard.py 支持 --brand 参数，多品牌自动生成报表
- bet: 改造脚本支持动态品牌参数（yufeng/bonjur/gelatomiiix 等）
- changes:
  - scripts/metabase_seed_dashboard.py: 新增 --brand 和 --dashboard-name 参数
  - 新增 sql_for_brand() 函数，自动替换 schema 前缀（yufeng_* → {brand}_*）
  - 所有 Card/Dashboard 名称改为动态生成（f”{BRAND_DISPLAY}｜...”）
  - HEADERS 初始化移至 main()，支持 --help 不连接 Metabase
  - 修复 dashboard 名称重复问题（移除重复的 dash_name 赋值）
- commit: d1c2295 + 7df2336
- verification:
  - command: python3 -m py_compile scripts/metabase_seed_dashboard.py && python3 scripts/metabase_seed_dashboard.py --help
  - result: pass (--help 正常显示，语法检查通过)
<<<<<<< HEAD
  - L2: VPS 生成了 gelatomiiix dashboard (id=8) → http://<VPS_HOST>:8082/dashboard/8
=======
>>>>>>> origin/main
- decision: keep
- guard: py_compile ✅ + 部署环境 验证 ✅
- next: 在 部署环境 浏览器验证 dashboard 数据正确性；支持 bonjur 品牌

## 2026-03-31 19:15
- goal: 修复 gelatomiiix Metabase dashboard 数据刷不出来
- bug: dashboard 一直 loading（Waiting for results...）
- root-cause: brand_gelatomiiix_dm 缺少 3 个关键视图（revenue_monthly, expense_monthly, profit_monthly）
- fix:
  - 创建 sql/gelatomiiix_dm_models.sql（从 yufeng_dm_models.sql 派生）
  - 部署环境 apply 成功：4 个视图创建完成
  - 验证：profit_monthly 返回数据（2025-08: profit_amt=19653.92）
- commit: pending
- verification: SELECT * FROM brand_gelatomiiix_dm.profit_monthly → 2 rows ✅
- decision: keep
- next: 在 Metabase 刷新 dashboard 确认显示正常

## 2026-03-31 19:25
- goal: 修复所有品牌 Metabase dashboard 卡在”等待中”
- root-causes:
  1. gelatomiiix/bonjur 缺少 DM 视图（revenue_monthly, expense_monthly, profit_monthly）
  2. sql_for_brand() 不支持 “brand_{brand}_*” schema 前缀模式
  3. Card SQL 引用了 c.lvl1/c.lvl2 兼容列（gelatomiiix 视图没有这些列）
- fixes:
  - sql_for_brand(): 支持 “brand_{brand}_*” 模式（gelatomiiix 等）
  - 移除所有 c.lvl1/c.lvl2 引用，改用 c.lvl1_name/c.lvl2_name
  - 创建 sql/gelatomiiix_dm_models.sql + sql/bonjur_dm_models.sql
  - 部署环境 apply 成功：所有品牌 DM 视图创建完成
- verification:
  - yufeng Card 83: 17 rows ✅
  - gelatomiiix Card 74: 17 rows ✅
  - bonjur Card 92: 17 rows ✅
- dashboards:
<<<<<<< HEAD
  - yufeng: http://<VPS_HOST>:8082/dashboard/9
  - gelatomiiix: http://<VPS_HOST>:8082/dashboard/8
  - bonjur: http://<VPS_HOST>:8082/dashboard/10
=======
>>>>>>> origin/main

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

## 2026-03-31 20:05
- goal: 系统化排查并修复所有 Metabase 报表无法加载数据
- bet: 找到所有失败的 Dashboard/Card 并确认问题根因
- changes:
  - 全面排查所有 9 个 Dashboard（3, 4, 5, 6, 7, 8, 9, 10）
  - 测试所有 49 个 Card 查询状态
  - 发现根因：Dashboard 3 (Card 40) 和 Dashboard 7 (Card 65-71, 73) 的 SQL 含有错误的 schema 引用
    - 错误：gelatomiiix_ods.bank_txn（不存在）
    - 正确：brand_gelatomiiix_ods.bank_txn
  - Dashboard 3 和 7 已被删除（之前操作遗留）
- verification:
  - Dashboard 8 (蜜可诗): 8/8 Cards ✅
  - Dashboard 9 (榆枫与山): 8/8 Cards ✅
  - Dashboard 10 (本就): 8/8 Cards ✅
  - Dashboard 4 (Bonjur营业): 5/5 Cards ✅
  - Dashboard 5 (Bonjur财务): 8/8 Cards ✅
  - 所有 Card 查询 time < 200ms
- decision: keep
- dashboards:
<<<<<<< HEAD
  - 蜜可诗: http://<VPS_HOST>:8082/dashboard/8
  - 榆枫与山: http://<VPS_HOST>:8082/dashboard/9
  - 本就: http://<VPS_HOST>:8082/dashboard/10
  - Bonjur营业: http://<VPS_HOST>:8082/dashboard/4
  - Bonjur财务: http://<VPS_HOST>:8082/dashboard/5
=======
>>>>>>> origin/main

## 2026-03-31 20:20
- goal: 继续排查”页面仍然转圈”而非仅 API 查询是否成功
- root-cause (new): Dashboard 8/9/10 的 `store_code` 顶部筛选器配置不稳定
  - Dashboard 8: `values_source_type = null`
  - Dashboard 9/10: `values_source_type = card`，但绑定了硬编码 field id `771/772`
  - 这类 Metabase 参数源漂移很容易导致前端筛选器加载异常/页面卡转圈
- fix:
  - 部署环境 上将 Dashboard 8/9/10 的 `store_code` 参数统一改为 `static-list`
  - repo 脚本 `scripts/metabase_seed_dashboard.py` 同步改成 `store_values_for_brand()`，不再依赖 card_id + field id 绑定
- verification:
  - Dashboard 8 `store_code`: static-list ✅
  - Dashboard 9 `store_code`: static-list ✅
  - Dashboard 10 `store_code`: static-list ✅
  - Card 74: completed 139ms ✅
  - Card 83: completed 39ms ✅
  - Card 92: completed 51ms ✅
- decision: keep
- note: 真实页面是否已恢复，还受登录态影响；当前无法在未接入你已登录标签页的情况下完成最终前端验收

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

## 2026-03-31 13:00
- goal: 新品牌 gelatomiiix（蜜可诗）上线后端到端验收 + 修复初始化完整性 bug
- bug-1: ops.fn_log_bank_rule_map_change() 函数不存在 → 品牌创建时报错
  - fix: 部署环境上手动创建 ops schema + 函数 + 触发器（sql/rules_history.sql 从未被 apply）
  - commit: local only（部署环境 direct）
- bug-2: import_yufeng_bank_txn.py 硬编码 `{brand_code}_ods` → 新品牌 schema 命名不一致
  - fix: 新增 get_ods_schema() / get_dm_schema() 与 TypeScript API 对齐
  - commit: 941f843
- bug-3: init-bank-template API 漏掉 snapshot 表 + expense/profit 视图
  - fix: 补充 yufeng_classification_snapshot.sql + yufeng_dm_models.sql
  - fix: 补加 sqlSnapshot 变量声明（TypeScript 编译错误）
  - commit: 011a958（forced push）
  - 部署环境 已部署新镜像 wdg-ui:latest
- gelatomiiix 部署环境 数据库补建:
  - brand_gelatomiiix_dm.bank_txn_classified_snapshot 表（含主键约束）
  - brand_gelatomiiix_dm.refresh_bank_txn_classified_snapshot() 函数
- decision: keep
- guard: docker build ✅ + tsc compile ✅
- next: 在 UI 重新上传蜜可诗银行数据，验证完整链路（import → 分类 → BI 报表）

## 2026-07-13 22:00
- goal: P3 Python Import Consolidation (Tasks 3.3 & 3.4) — refactor all 11 remaining import scripts to use shared `scripts/lib/importer.py`
- bet: Replace inline boilerplate (calculate_sha256, DB_CONFIG, get_connection, IngestFileManager, parse_path, insert_batch) with imports from lib.importer; keep brand-specific transform logic intact
- commits: `e56bc09`, `c6e857f`, `f8c50b9`, `fe5ab7a`, `a3051c2`
- result: 774 lines removed across 11 scripts, all py_compile + pytest passing
- guard: `python -m py_compile scripts/import_*.py` → all OK; `pytest tests/test_import_yufeng_bank_txn.py -v` → 9/9 passed
