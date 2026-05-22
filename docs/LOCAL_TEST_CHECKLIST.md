# 完整本地测试 Checklist（最小版）

目标：在 **本机** 从“空库/空环境”可复现地跑通：**启动PG → 初始化DDL/规则 → 导入样例 → 分类&生成DM → 覆盖率/未分类 → ops 运行记录**。

> 约定：以下命令默认在项目代码根目录执行；DB 连接可复用 `docs/ACCEPTANCE_RUNBOOK.md` 的环境变量。

1. **启动 PostgreSQL 16**（本地或 Docker）
   - 命令：`docker run -d --name dataplatform-pg -e POSTGRES_DB=dataplatform -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`
   - 验收：`psql -h localhost -U postgres -d dataplatform -c "select 1"` 返回 1

2. **设置 DB 环境变量**
   - 命令：`export DB_HOST=localhost DB_PORT=5432 DB_NAME=dataplatform DB_USER=postgres DB_PASSWORD=postgres`
   - 验收：后续 Python/psql 连接不再报认证或连接失败

3. **初始化 DDL（首次/空库）**（按顺序执行）
   - 命令（示例）：
     - `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f ops/OPS_DDL.sql`
     - `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f brand-docs/Yufeng_ODS_DDL.sql`
     - `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f brand-docs/Yufeng_CFG_DDL.sql`
     - `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f sql/yufeng_apply_classification.sql`
   - 验收：`\dn` 可看到 `raw/ops/yufeng_ods/yufeng_cfg/yufeng_dm` 等 schema（至少 yufeng_* 存在）

4. **导入样例数据（先 dry-run）**
   - 命令：`python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx --dry-run`
   - 验收：无异常退出；输出行数/字段解析正常（不写库）

5. **导入样例数据（真实写库）**
   - 命令：`python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx`
   - 验收：`select count(*) from yufeng_ods.bank_txn;` > 0；`raw.ingest_file` 有新增记录

6. **运行分类 + 生成 DM（pipeline oneclick）**
   - 命令：`python scripts/run_pipeline_oneclick.py --brand yufeng --month 2025-07`
   - 验收：进程退出码=0；`ops.pipeline_run/ops.step_run` 有本次运行记录且状态为 success

7. **验收 DM 主结果可查询**
   - SQL：`select * from yufeng_dm.revenue_monthly;` / `expense_monthly;` / `profit_monthly;`
   - 验收：三张表均可查询；金额列非全 NULL；月份范围符合导入月份

8. **验收覆盖率视图**
   - SQL：`select * from yufeng_dm.v_coverage_monthly;`
   - 验收：`covered_rows <= total_rows` 且覆盖率字段存在；in/out 分开统计存在

9. **验收未分类清单**
   - SQL：`select * from yufeng_dm.v_unclassified_top where month='2025-07' limit 20;`
   - 验收：能返回 TopN（允许为空）；如非空，`v_unclassified_detail` 可下钻到 bank_txn_id

10. **验收规则回归/冲突统计（最小抽检）**
   - SQL：`select * from yufeng_dm.v_rule_regression_check where diff_type is not null;`
   - 验收：允许 0 行；若有差异可解释并可复现

11. **记录 ops 证据（可追溯）**
   - SQL：`select * from ops.pipeline_run order by started_at desc limit 3;`
   - 验收：能看到本次 run_id、耗时、成功/失败、关键行数（如有）

12. **产出“本次本地跑通记录”**（一次一份）
   - 动作：把关键查询结果/截图/命令执行日志追加到：`docs/REAL_RUN_YYYY-MM-DD.md`
   - 验收：他人按本 checklist 能复现同样的关键结果
