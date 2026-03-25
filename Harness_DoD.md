# Harness DoD｜WDG

## 任何一次“完成”至少要满足
- [ ] `ProjectTasks.md` 变更记录已补：写清楚改了什么、改到哪里、为什么改
- [ ] 对应任务状态已同步（To Do / Doing / Done / 风险）
- [ ] 有验证证据：命令输出、页面截图、SQL 查询结果、或运行文档链接
- [ ] 跑过 guard：优先 `bash scripts/run_change_guard.sh`，至少 `bash scripts/run_drift_check.sh`
- [ ] 若存在已知风险/回退点，已在 `ProjectTasks.md` 明确记录

## 证据格式（推荐）
1. 变更摘要：一句话说明本次交付
2. 关键路径：列出修改文件/脚本/页面/SQL
3. 验证方式：命令 / 页面 / 文档 / 数据查询
4. 验证结果：通过 / 警告 / 风险接受

## 对 WDG 的额外要求
- 涉及分类规则、override、匹配模式、覆盖率阀门的改动，必须写明影响品牌（Bonjur / Yufeng）与影响范围。
- 涉及 dashboard / Metabase / UI 的改动，必须给出入口路径或页面说明。
- 涉及数据清理、重跑、迁移的动作，必须给出回滚或重建方式。
- 涉及 **本机↔VPS 对齐/上线**：
  - 默认采用“保守同步”（clone→rsync→apply SQL→seed Metabase），不重启容器
  - 必须附：同步命令/脚本、同步的目录范围、以及 smoke 结果（UI/Metabase/DB 任一即可）
- 涉及 Metabase：必须保证 seed 脚本可重复执行（idempotent by name），避免手工 UI 改到漂移。
