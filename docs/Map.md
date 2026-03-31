# Project Map｜WDG

## Goal
把营业日报与银行流水两类源数据统一接入、清洗、分类、建模，并产出可复用的月度财务分析结果（利润统计 / 费用汇总 / 收入对账），支持本机开发与后续 VPS 迁移。

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

## Deploy surfaces（本机 / VPS）

### VPS（生产/对外）
- **VPS**: `112.124.18.246`
- **项目路径**: `/opt/wdg-data-foundation`
- **UI**: `http://112.124.18.246:3002`（容器 `dataplatform-ui`）
- **Metabase**: `http://112.124.18.246:8082`（对外入口为 `dataplatform-metabase-proxy` → `dataplatform-metabase:3000`）
- **Postgres**: `127.0.0.1:5432`（容器 `dataplatform-pg-dashboard`，仅本机回环）
- **Metabase API Key（VPS）**: `/root/.secrets/metabase_api_key`（600 权限）

### 保守同步（不重启容器）
用于“保持本地与 VPS 内容一致”的默认手段：
1) `git clone` 到临时目录（VPS 上 `/opt/_sync/...`）
2) `rsync` 覆盖 **scripts/sql/ui + docker-compose*.yml** 到 `/opt/wdg-data-foundation/`
3) 执行安全 SQL（view/函数）
4) 运行 Metabase seed：`scripts/metabase_seed_dashboard.py`

## Main workstreams
1. 数据接入：Excel/CSV → RAW/ODS
2. 分类治理：rule_map / override / 未分类治理 / 人工匹配
3. 数据建模：DM 报表层（收入、费用、利润、覆盖率）
4. 交付展示：UI / Metabase / dashboard
5. 运维部署：本机开发、Compose、VPS 迁移

## How to verify
- 最小验证：`bash scripts/run_drift_check.sh`
- 推荐验证：`bash scripts/run_change_guard.sh`
- 端到端参考：`docs/ACCEPTANCE_RUNBOOK.md`
- 历史证据：`docs/REAL_RUN_2026-03-22.md`

## Guard commands
- `bash scripts/run_change_guard.sh`
- `bash scripts/run_drift_check.sh`
- `bash scripts/require_project_updates.sh`
