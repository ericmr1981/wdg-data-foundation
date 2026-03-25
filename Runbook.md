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

## Guard 结果处理
- `risk=0`：可继续
- `warn>0`：需要判断是否合理，并在必要时记录到 `ProjectTasks.md`
- `risk>0`：不应宣称完成，先修复或记录风险接受

## 当前已知告警（2026-03-24）
- drift_check 警告：本机 `127.0.0.1:3460` 被 Python 进程占用
- 处理原则：若这是 WDG/UI/本机开发相关进程，可接受；若不是，需要确认来源后再继续
