# Runbook｜WDG

## 日常整理 / 收尾流程
1. 在 `ProjectTasks.md` 更新变更记录与任务状态
2. 如有新入口/脚本/文档，补到 `Map.md`
3. 跑：`bash scripts/run_change_guard.sh`
4. 若 guard 报风险：修复或记录风险接受
5. 再给出对外结论

## 常用入口
- 本机启动：见 `docs/LOCAL_STARTUP.md`
- 端到端验收：见 `docs/ACCEPTANCE_RUNBOOK.md`
- 一键脚本：`scripts/dev.sh`
- 一键链路：`scripts/run_pipeline_oneclick.py`

## VPS｜保守同步（不重启容器，推荐默认）
目标：保持“仓库内容”与 VPS `/opt/wdg-data-foundation` 的 **scripts/sql/ui** 一致，同时不影响现网容器运行。

### 同步步骤（概念）
1) VPS 上 `git clone` 仓库到临时目录（如 `/opt/_sync/...`）
2) `rsync` 覆盖：`scripts/`、`sql/`、`ui/`、`docker-compose*.yml`
3) 执行安全 SQL（view/函数）：如 `sql/yufeng_dm_models.sql`
4) 运行 Metabase seed：`scripts/metabase_seed_dashboard.py`
5) Smoke：UI / Metabase / DB 任一验证通过即可

### Smoke 参考
- Metabase：`POST /api/card/40/query` 返回 202 且有数据
- Dashboard：`/dashboard/3` 可打开，卡片 `40/41/42/43/45` 均有数据

## Guard 结果处理
- `risk=0`：可继续
- `warn>0`：需要判断是否合理，并在必要时记录到 `ProjectTasks.md`
- `risk>0`：不应宣称完成，先修复或记录风险接受

## 当前已知告警（历史）
- 2026-03-24：drift_check 警告：本机 `127.0.0.1:3460` 被 Python 进程占用（需结合实际运行判断是否接受）
