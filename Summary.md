WDG 项目用于把分散的数据源（营业日报、银行流水）统一接入、清洗、分类、建模，并以稳定口径对外提供数据服务（UI/接口/报表）。核心目标：**口径清晰、链路可复现、本机与 VPS 一致**。

近期变更（2026-03-25）
- **VPS Metabase“等待中”修复**：对外入口增加 Nginx 代理，隐藏 CSP/XFO header（不改 Metabase 容器本体），解决前端渲染被 CSP 拦截导致的无限 loading。
- **利润/现金流口径更新（DB）**：
  - `profit_amt = 营业收入 - 支出总金额 + 营建费用`
  - 新增 `cashflow_amt = 收入总金额 - 支出总金额`
- **Metabase 看板统一**：`dashboard=3（榆枫与山｜经营看板）`，卡片固定 `40/41/42/43/45`，统一筛选：月/门店/一级/二级；card40 增加“当月现金流”。
- **新增趋势对比图**：`Yufeng｜营业收入 vs 支出（不含营建）`（card=45）。
- **本机↔VPS 一致性**：升级 `scripts/metabase_seed_dashboard.py`（适配 Metabase v0.59+ dataset_query=stages，idempotent by name），并确定默认上线方式为“保守同步”（clone→rsync→apply SQL→seed Metabase，不重启容器）。

近期变更（2026-03-24）
- Yufeng 字典表已“彻底删除” `UNCLASSIFIED(未分类)` 与 `OTHER_OUT(其他支出)`；兜底改为 `classified_source='unclassified'` 且 `lvl1_code/lvl2_code=NULL`，规则/override 已清理并完成 E2E 验收。
- UI：规则管理页移除文件列表展示；重跑匹配收敛为“按当前品牌全部文件重跑”。
