WDG 项目用于把分散的数据源统一接入、清洗、建模，并以稳定口径对外提供数据服务（报表/分析/接口）。首要目标是明确范围与指标口径，并跑通至少一条端到端链路（采集→清洗→建模→服务/报表），同时具备基础数据质量与监控告警能力。

近期变更（2026-03-25）：
- Dashboard 口径对齐：利润/利润率统一使用 DB 视图 `yufeng_dm.profit_monthly`，并在收支总揽表增加“毛利率”。
- `yufeng_dm.profit_monthly` 增加 `store_code` 维度，补齐毛利相关字段（毛利率口径：`(营业收入-材料采购)/营业收入`）。

近期变更（2026-03-24）：
- Yufeng 字典表已“彻底删除” `UNCLASSIFIED(未分类)` 与 `OTHER_OUT(其他支出)`；分类兜底改为 `classified_source='unclassified'` 且 `lvl1_code/lvl2_code=NULL`，规则/override 已清理并完成 E2E 验收。
- 规则管理页：移除文件列表展示；重跑匹配收敛为“按当前品牌全部文件重跑”。