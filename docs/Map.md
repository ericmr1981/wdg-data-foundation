# Project Map｜WDG

## Goal
把营业日报与银行流水两类源数据统一接入、清洗、分类、建模，并产出可复用的月度财务分析结果（利润统计 / 费用汇总 / 收入对账），支持本机开发。

## Key paths
- 项目总控：`ProjectTasks.md`
- 项目摘要：`Summary.md`
- 项目说明：`Readme.md`
- 字段/指标思维导图：`FieldTree.md`
- 验收/运行文档：`docs/ACCEPTANCE_RUNBOOK.md`
- 真实跑通记录：`docs/REAL_RUN_2026-03-22.md`
- 本机启动与测试：`docs/LOCAL_STARTUP.md` / `docs/LOCAL_TEST_CHECKLIST.md`
- 脚本入口：`scripts/dev.sh`
- 一键跑链路：`scripts/run_pipeline_oneclick.py`
- 榆枫银行流水导入：`scripts/import_yufeng_bank_txn.py`
- 本就营业日报导入：`scripts/import_bonjur_sales_daily.py`
- 匹配候选提取：`scripts/extract_match_candidates.py`
- 分类验证：`scripts/verify_yufeng_classification.py`
- SQL 模型：`sql/`
- 品牌口径资料：`brand-docs/`
- 输入样例：`inputs/`
- 产出物：`outputs/`
- UI：`ui/`
- 运维资料：`ops/`

## Deploy surfaces（本机）
- UI（dev）：`http://localhost:3000`
- UI（容器）：`http://localhost:3002`（见 `docker-compose.yml`）
- Metabase：`http://localhost:${METABASE_PORT:-8082}`
- Postgres：`127.0.0.1:${DB_PORT:-5432}`

## Main workstreams
1. 数据接入：Excel/CSV → RAW/ODS
2. 分类治理：rule_map / override / 未分类治理 / 人工匹配
3. 数据建模：DM 报表层（收入、费用、利润、覆盖率）
4. 交付展示：UI / Metabase / dashboard
5. 运维部署：本机开发（部署由使用者自行决定）

## How to verify
- 最小验证：`bash scripts/run_drift_check.sh`
- 推荐验证：`bash scripts/run_change_guard.sh`
- 端到端参考：`docs/ACCEPTANCE_RUNBOOK.md`
- 历史证据：`docs/REAL_RUN_2026-03-22.md`

## Guard commands
- `bash scripts/run_change_guard.sh`
- `bash scripts/run_drift_check.sh`
- `bash scripts/require_project_updates.sh`
