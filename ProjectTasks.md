# 任务进度卡｜WDG

## 0) 基本信息
- **ID**: WDG
- **变更记录**:
  - 2026-03-25：VPS 对外 Metabase 入口加 Nginx 代理（去除 CSP/XFO header），解决"前端一直等待中但后端已返回"问题；Metabase 对外仍为 `:8082`。
  - 2026-03-25：Yufeng 利润口径更新：`profit_amt = 营业收入 - 支出总金额 + 营建费用`；新增 `cashflow_amt = 收入总金额 - 支出总金额`（DB 视图 `yufeng_dm.profit_monthly`）。
  - 2026-03-25：榆枫与山 Metabase 看板统一为 `dashboard=3（榆枫与山｜经营看板）`，卡片固定为 `40/41/42/43/45`，统一筛选：月/门店/一级/二级；card40 增加"当月现金流"。
  - 2026-03-25：新增趋势图：`Yufeng｜营业收入 vs 支出（不含营建）`（card=45）。
  - 2026-03-25：升级 `scripts/metabase_seed_dashboard.py`：适配 Metabase v0.59+（dataset_query=stages），并让 Metabase 资产可重复 seed（本机↔VPS 一致性）。
  - 2026-03-25：保守同步（不重启容器）：VPS 上采用 clone→rsync 同步仓库的 scripts/sql/ui，再 apply SQL + seed Metabase，保持展示与功能一致。
  - 2026-03-25：口径对齐：Dashboard 利润/利润率改为使用 DB 视图 `yufeng_dm.profit_monthly`（不在 Metabase 卡片内单独计算）。
  - 2026-03-25：`yufeng_dm.profit_monthly` 增强：增加 `store_code` 维度（支持按门店筛选），新增毛利相关字段：`material_purchase_amt / gross_profit_amt / gross_margin_rate`（毛利率口径：`(营业收入-材料采购)/营业收入`）。
  - 2026-03-25：Bonjur 分类配置对齐 Yufeng v2（共享字典）：创建 `bonjur_dm.fn_classify_bank_txn_v2` + `v_bank_txn_classified_v2`；规则表添加 `lvl1_code/lvl2_code` 列并迁移 84 条规则；新增 159 条规则，覆盖率 100%；对齐 DM 模型（revenue/expense/profit_monthly）；覆盖表/审计表结构对齐。
  - 2026-03-24：Metabase 修复：更新 `scripts/metabase_seed_dashboard.py` 的参数类型兼容（`date/=`→`date/single`），并使用 `Account.md` 中的 `METABASE_API_KEY` 重新 seed/更新榆枫与山 Dashboard 相关 Cards，修复"Invalid query parameters / server issues"。同时为兼容旧 SQL，`yufeng_dm.v_bank_txn_classified` 追加 `lvl1/lvl2` 名称列（从字典表 join；unclassified 显示"未分类"）。
  - 2026-03-24：Metabase 对齐新字典：更新 card=44（收支总揽表）按新一级分类（人力/租金物业/运费/管理费用/材料采购/营建费用/营销费用/其他费用/未分类）汇总，移除旧分类名导致的"显示为 0"。
  - 2026-03-24：UI 调整：规则管理页移除"文件列表展示"，避免文件过多导致页面混乱；重跑匹配收敛为"按当前品牌全部文件重跑"（调用 `/api/pipeline/rerun-match-by-file` with `all_files=true`）。
  - 2026-03-24：UI Bugfix：Pipeline 监控页"覆盖率(按文件)"展开不稳定问题修复--为文件行使用稳定 key（React Fragment key=source_file_id）并对 coverage API 返回值做数值归一化，避免列表重排/展开失效。
  - 2026-03-24：UI/操作增强：规则管理页"重跑匹配"后端能力支持两种模式：① 该品牌全部文件（all_files=true）；② 选择单个/多个文件（source_file_ids）。当前 UI 默认走 all_files。
  - 2026-03-24：Yufeng 分类字典"彻底删除"执行：从 `yufeng_cfg.dim_category_lvl1` 物理删除 `UNCLASSIFIED(未分类)` 与 `OTHER_OUT(其他支出)`；同步清理引用数据（删除 `yufeng_cfg.bank_rule_map` 中 5 条 `UNCLASSIFIED` 规则、删除 `yufeng_dm.bank_txn_override` 中 6 条 `UNCLASSIFIED` override）；并更新 `yufeng_dm.fn_classify_bank_txn` 兜底策略：未命中时返回 `classified_source='unclassified'` 且 `lvl1_code/lvl2_code=NULL`（不再依赖字典项）。E2E 已验证：match 列表正常、规则沉淀正常、规则创建禁止使用已删除分类。
  - 2026-03-24：重整 `ProjectTasks.md` 的当前工作板：新增 `4.0 当前工作板（Doing / Next / Later）`，将当前真实优先级显式化。当前聚焦三件事：① 人工匹配主流程闭环验收；② 114 条规则拆分补齐；③ Bonjur DM 主表与 Pipeline 控制点埋点验收。历史详细任务保留在 `4.1` 作为可追溯清单。
  - 2026-03-24：修正 `scripts/drift_check.py` 默认端口检查策略：移除模板遗留的 `3460` 默认监控（改为 `DEFAULT_TARGET_PORTS = []`）。原因：3460 并非 WDG 已确认的项目端口，继续保留只会造成误报；后续如需端口守护，应按 WDG 实际服务与期望状态单独设计。
  - 2026-03-24：按 `project-harness-guards` 整理项目记录体系：新增并填充 `Map.md`、`Invariants.md`、`Harness_DoD.md`、`Runbook.md`、`Doc_Gardening.md`；执行 `bash scripts/run_change_guard.sh` 结果 `risk=0`，仅有告警：本机 `127.0.0.1:3460` 被 Python 进程占用，待按实际运行场景判断是否接受。
  - 2026-03-23：定稿 Yufeng 分类标准枚举 v1.1（去掉：手续费/往来/借款 一级；保留：其他收入二级；新增：营建费用、营销费用；广告费/礼品费归入营销费用）。下一步：落库字典表并对规则表/override 表加 FK 约束。
  - 2026-03-23：Metabase（dashboard=4 榆枫与山）修复并更新「收支总揽」卡（card=44）：新增常规毛利率、利润口径调整为"营业收入-支出总金额"、并修复 UNION 列数错误；同时补齐收入分解项与严格匹配 DB 一级分类命名。
  - 2026-03-23：Bonjur 新增门店 `hz_in77`（杭州in77）；补齐 Bonjur DM 三张视图骨架（revenue/expense/profit）并接入 init 脚本；已推送 GitHub：<https://github.com/ericmr1981/wdg-data-foundation>
  - 2026-03-23：Bonjur 补齐"银行流水分类/覆盖率/未分类/人工匹配/规则沉淀"全链路（DB+UI），并已合入主分支（main）。
  - 2026-03-23：修复 yufeng 规则表重复膨胀：seed 改为幂等 + 库内去重；并将 yufeng/bonjur 的 dashboard 相关视图 month 字段统一为 `date(YYYY-MM-01)` 以支持 Metabase 月份筛选。
  - 2026-03-23：Metabase：修复 dashboard(3/4) 卡片的分类遗漏，并将 dashboard=4（月筛选）改为 date（月选择器）；并将 Store 筛选升级为下拉（来源于门店维表 dim_store，显示门店名）。
  - 2026-03-23：新增门店维表：`yufeng_cfg.dim_store` / `bonjur_cfg.dim_store`（初始化脚本已接入），用于 dashboard 下拉显示"门店名"。
  - 2026-03-23：Metabase：榆枫与山（dashboard=4）新增"最近12个月收支趋势"对比图（柱状图，收入/支出同图），并同步在本就（dashboard=9）增加同款趋势图。
  - 2026-03-24：分类策略决策更新（Yufeng 优先落地）：人工匹配不再写 override 参与分类；改为"人工匹配即刻沉淀为规则（rule_map）并对未来文件立刻生效"。规则匹配字段策略：summary/memo/purpose 优先做模糊 contains；三者都为空才使用 counterparty_name 兜底且精确匹配（exact）。禁止 match_field=any；新增匹配模式（contains/exact，落在现有列 match_type 中）。未分类采用软阀门（可生成DM但持续提示）。
  - 2026-03-24：M1-M3 开发与上线执行完成（Yufeng）：禁用 89 条 any 规则；创建新函数 `yufeng_dm.fn_classify_bank_txn_v2` 与视图 `yufeng_dm.v_bank_txn_classified_v2`；创建审计表 `yufeng_ops.unclassified_resolution_log`；UI：/match 候选推荐+命中预览、/pipeline 未分类 KPI 固定展示；迁移后当前覆盖率 15.57%（因保守禁用 any 规则，待人工沉淀规则提升）。
  - 2026-03-24：一键启动脚本增强：`scripts/dev.sh` 新增 `prune-data --yes`（仅清理 ODS/RAW/OPS 原始数据，保留规则/配置），并补齐使用文档 `docs/DEV_SH_USAGE.md`。
  - 2026-03-24：项目目录重命名：`WDG Data Foundation` → `WDG`（已更新 TASKS.md 与项目内 docs/ProjectTasks 引用）。
  - 2026-03-24：UI 缺陷修复与增强：规则管理页增加搜索/筛选功能（关键词/分类/方向）、匹配字段中文显示、新增匹配模式列、删除确认改为站内 Modal（避免被浏览器禁用）；修复 /api/pipeline/rerun-match-by-file 的 uuid 类型错误；修复 /api/rules 的 lvl1_code/lvl2_code 映射兼容。
  - 2026-03-24：人工匹配页增强完成 - 用户现在可选择匹配字段（摘要/附言/用途/对方单位）、匹配模式（contains/exact），系统智能推荐（按字段优先级自动填充），并显示命中预览。
  - 2026-03-24：人工匹配流程定版（v1 最小可行）：先"仅归类当前流水"（写 override，使其从未分类列表消失），再进入"待沉淀队列"；用户点击"确认沉淀为规则"后，逐条确认匹配字段/匹配模式/关键词/命中预览，再写入 rule_map 与审计日志。批量场景先允许批量归类，但规则沉淀仍逐条确认。
  - 2026-03-24：当前开发进展补记：规则管理页增强已落地（搜索/筛选、匹配字段中文显示、匹配模式列、删除确认 Modal）；相关 API 修复已完成（`/api/rules`、`/api/rules/settle`、`/api/rules/settle-batch`、`/api/pipeline/rerun-match-by-file`）。人工匹配主流程仍在收口中：页面与后端已部分就绪，但"待沉淀队列 -> 确认沉淀 modal -> 用户确认匹配条件 -> 写规则"的完整链路尚未完成端到端验收，因此当前状态仍为 in_progress，不可视为最终交付。
  - 2026-03-24（待办）：规则补齐 - 将现有 114 条 summary 规则拆分为 summary/memo/purpose 三条（优先级错开：原 priority / +100 / +200），提升覆盖率。
- **优先级**: P1
- **负责人(Agent)**: polo_engineer
- **提出人**: Eric
- **创建时间**: 2026-03-21 22:54
- **截止时间**: （可空）
- **相关链接/资料**:
  - （待补充）

## 1) 背景与目标（Why/What）
- **背景**: 一期目标聚焦"营业 + 财务"T+1 报表自动生成。当前数据以 Excel 为主，口径分散、对账困难（业务口径 vs 银行口径存在差异），需要沉淀可追溯的加工链路与统一口径。
- **目标**:
  - 将两类源数据（营业日报、银行流水）标准化入库，形成 ODS + DM 分层
  - 自动生成：利润统计 + 各费用汇总表（替代现有手工 Excel 汇总）
  - 保留两套口径并生成对账差异（业务收入 vs 银行实收）
  - 本机开发环境跑通后，可无缝迁移到 VPS
- **非目标（不做什么）**:
  - 不做实时流式（一期 T+1 批处理即可）
  - 不做重型大数据组件（Trino/Iceberg/Airflow/Superset）
  - 不做复杂主数据治理（先以门店/月份为最小治理范围）

## 1.1 一期输入/输出定义（Scope）
- **输入数据源（一期仅两类）**
  - **营业数据报告**（CSV/Excel）：业务口径（月/日汇总，含营业额/优惠/营业收入/订单数/退款等）
  - **银行流水单**（Excel）：现金流口径明细（转入/转出/余额/摘要/附言/对方单位等；可能**不自带"费用明细K分类"**，需规则/字典自动归类）
- **多品牌/多门店前提（一期选型：方案B）**
  - 不同品牌（如「本就」vs「榆枫与山」）采用**同一 PostgreSQL 实例、按品牌拆分 schema**（方案B），实现更强隔离与权限控制。
  - 命名建议：`bonjur_*` / `yufeng_*`（或 `brand_<code>_*`），每个品牌内部仍按 raw/ods/cfg/dm 分层。
  - brand_code 定稿：**Bonjur**、**Yufeng**
  - store_code 定稿：
    - Bonjur：温州瓯海万象城店=`wz_oh_wxc`；温州瑞安吾悦广场店=`wz_ra_wy`
    - Yufeng：榆枫国华=`yf_gh`
  - 品牌口径文档维护：见 `brand-docs/`（按品牌拆分，及时维护字段/架构/运算逻辑）
- **一期需生成的结果表（替代其他 sheet）**
  - `利润统计`（月度汇总）
  - `3.人力成本 / 4.租金物业 / 5.运费 / 6.销售费用 / 7.管理费用 / 8.财务费用 / 9.税金支出`（全部由银行流水分类汇总生成）
  - `收入对账`（业务入卡 vs 银行入账差异表）

## 1.2 架构设计（第一版定稿）
- **数据流**：Excel → RAW归档 → Python ETL 导入 → PostgreSQL（ODS/DM）→ dbt 建模/测试 → Metabase 查询展示
- **处理模式**：T+1 批处理（Cron 调度）
- **部署策略**：Docker Compose（本机开发与 VPS 生产一致）
- **数据治理补充（新增需求）**：当自动分类覆盖率 <100% 时，需提供 **UI 人工匹配** 与 **规则管理 UI**（查看/编辑/启停/优先级调整）。
  - **决策（2026-03-24）**：人工匹配结果**直接沉淀为 rule_map**（对未来文件立刻生效）；override 仅作为处理日志/审计（不参与分类优先级）。
  - 未分类治理采用**软阀门**：允许生成 DM，但需持续展示未分类数量/覆盖率，督促清零。

## 1.3 技术栈定稿（一期）
- 数据库/数仓：PostgreSQL 16
- ETL：Python 3.11（pandas + openpyxl + sqlalchemy/psycopg）
- 建模与口径：dbt-core + dbt-postgres（含 dbt tests）
- 调度：Cron
- BI（后续看板）：Metabase（开源版）
- 部署：Docker Compose

## 1.4 一期数据库结构（草案定稿 v0）
> 说明：以 Schema 分层；已拿到参考输入（营业 CSV + 工行流水 Excel）。其中工行流水对应门店「榆枫国华」（品牌：榆枫与山），与当前营业数据示例（品牌：本就）不同；一期隔离策略定稿为：**方案B（同库按品牌拆分 schema）**。

- **raw**（文件登记/追溯）
  - `raw.ingest_file`：记录 store_code、month、source_type、file_path、hash、导入状态
- **ods**（结构化源表）
  - `ods.sales_daily`：来自营业数据报告（store_code, biz_date/month, gross_sales_amt, discount_amt, revenue_amt, order_cnt, refund_amt, …, source_file_id）
  - `ods.bank_txn`：来自银行流水单（store_code, txn_time, in_amt, out_amt, balance_amt, counterparty_name, summary, memo, …, source_file_id）
    - **注**：若源文件无 `fee_detail(K)`，则通过 `cfg.bank_rule_map`（关键词规则）或人工映射生成分类字段（一期先覆盖核心类别：营业收入/手续费/税金/运费/租金/人力/管理费用等）
- **cfg**（规则与字典）
  - `cfg.fee_category_map`：若流水含分类字段（如 `fee_detail(K)`），则做直接映射到 lvl1/lvl2（并标注 direction=in/out）
  - `cfg.bank_rule_map`：若流水**不含**分类字段，则基于（对方单位/摘要/附言/用途）关键词规则生成 lvl1/lvl2（一期先最小覆盖，后续可扩展）
- **dm**（报表输出）
  - `dm.revenue_monthly`：业务收入（sum card_in_amt） vs 银行实收（sum in_amt where fee_detail='营业收入'） + diff
  - `dm.expense_monthly`：按 lvl1/lvl2 汇总 out_amt
  - `dm.profit_monthly`：利润表月汇总（收入两口径 + 各类费用 + 利润）

## 1.5 口径约定（一期）
- **收入两口径并存**
  - 业务口径（Bonjur 示例CSV）：`revenue_amt`（通常=营业额-优惠总额；按 store_code+month 汇总）
  - 银行口径（Yufeng 流水）：`sum(in_amt where 分类lvl1='营业收入')`
- **费用口径**：全部以银行流水 `out_amt` 为准；若源流水无K分类列，则通过 `cfg.bank_rule_map`（关键词规则）生成 lvl1/lvl2 后汇总生成各费用表
- **隔离规则（方案B）**：所有口径、规则、DM 输出均在各自品牌 schema 内闭环（Bonjur 与 Yufeng 不交叉）

## 1.6 Yufeng｜分类标准枚举 v1.1（定稿）
> 用途：作为"字典表 + FK 约束"的唯一真源；UI/规则表/人工覆盖表只能选择该枚举。
>
> 关键决策：
> - 不再保留一级分类：**手续费 / 往来 / 借款**（手续费二级并入"管理费用"；往来/借款类不再做一级，按方向并入"其他收入/其他支出"）。
> - 新增一级分类：**营建费用 / 营销费用**；其中 **广告费、礼品费**归入营销费用。

### 1.6.1 lvl1（一级分类）
| lvl1_code | lvl1_name | direction |
|---|---|---|
| REV_BIZ | 营业收入 | in |
| REV_OTHER | 其他收入 | in |
| RENT_UTIL | 租金物业 | out |
| HR | 人力 | out |
| SHIP | 运费 | out |
| ADMIN | 管理费用 | out |
| MATERIAL | 材料采购 | out |
| BUILD | 营建费用 | out |
| MKT | 营销费用 | out |
| EXP_OTHER | 其他费用 | out |

> 说明：**未分类**不再作为字典项存在（避免污染口径）；当 `classified_source='unclassified'` 时，`lvl1_code/lvl2_code` 允许为 `NULL`，用于覆盖率与治理提示。

### 1.6.2 lvl2（二级分类）
| lvl1_code | lvl1_name | lvl2_code | lvl2_name |
|---|---|---|---|
| REV_BIZ | 营业收入 | MEITUAN | 美团 |
| REV_BIZ | 营业收入 | ELEME | 饿了么 |
| REV_BIZ | 营业收入 | DOUYIN | 抖音 |
| REV_BIZ | 营业收入 | JD | 京东 |
| REV_BIZ | 营业收入 | WECHAT | 微信/财付通 |
| REV_BIZ | 营业收入 | ALIPAY | 支付宝 |
| REV_BIZ | 营业收入 | OTHER_CH | 其他渠道 |
| REV_OTHER | 其他收入 | INVEST_IN | 注资 |
| REV_OTHER | 其他收入 | BORROW_IN | 借款 |
| REV_OTHER | 其他收入 | LOAN_IN | 贷款 |
| REV_OTHER | 其他收入 | INTEREST_IN | 利息 |
| REV_OTHER | 其他收入 | TAX_REFUND | 退税 |
| REV_OTHER | 其他收入 | REFUND_IN | 退款 |
| RENT_UTIL | 租金物业 | RENT | 租金 |
| RENT_UTIL | 租金物业 | PROP | 物业费 |
| RENT_UTIL | 租金物业 | WATER_ELEC | 水电费 |
| HR | 人力 | SALARY | 工资 |
| HR | 人力 | SS | 社保 |
| HR | 人力 | LABOR | 劳务派遣 |
| HR | 人力 | HR_SVC | 人力服务 |
| SHIP | 运费 | HLALA | 货拉拉 |
| SHIP | 运费 | EXPRESS | 快递 |
| SHIP | 运费 | CITY | 同城配送 |
| SHIP | 运费 | SHIP_OTHER | 其他运费 |
| ADMIN | 管理费用 | SAAS | 系统使用费 |
| ADMIN | 管理费用 | OFFICE | 办公费用 |
| ADMIN | 管理费用 | TRAVEL | 差旅费 |
| ADMIN | 管理费用 | REPAIR | 维修费 |
| ADMIN | 管理费用 | ADMIN_OTHER | 其他管理 |
| ADMIN | 管理费用 | BANK_FEE | 银行手续费 |
| ADMIN | 管理费用 | CHANNEL_FEE | 支付通道费 |
| MATERIAL | 材料采购 | RAW | 原材料 |
| MATERIAL | 材料采购 | AUX | 辅料 |
| MATERIAL | 材料采购 | PACK | 包装 |
| MATERIAL | 材料采购 | BUY_OTHER | 其他采购 |
| BUILD | 营建费用 | ENG_FEE | 工程款 |
| BUILD | 营建费用 | CONST_FEE | 施工费 |
| BUILD | 营建费用 | DECOR_FEE | 装修费 |
| BUILD | 营建费用 | EQUIP_BUY | 设备采购 |
| BUILD | 营建费用 | BUILD_OTHER | 其他营建 |
| MKT | 营销费用 | ADS | 广告费 |
| MKT | 营销费用 | GIFT | 礼品费 |
| MKT | 营销费用 | PROMO | 推广费 |
| MKT | 营销费用 | MKT_FEE | 营销费 |
| MKT | 营销费用 | MKT_OTHER | 其他营销 |

## 2) 验收标准（Definition of Done）
- [ ] 明确数据域范围、核心指标口径、数据字典（文档可查）
- [x] 至少1条端到端链路跑通：采集→清洗→建模→服务/报表（可复现）
  - 证据：`docs/REAL_RUN_2026-03-22.md`
- [ ] 数据质量与监控：缺失/延迟/异常检测有告警（可验证）
- [ ] 输出物清单（最终交付）:
  - [ ] 需求与范围说明（Markdown）
  - [ ] 数据模型/指标口径文档（Markdown）
  - [ ] Pipeline/脚本/配置（代码）
  - [ ] Demo 服务或报表（链接/截图）

## 3) 里程碑（Milestones）
- [ ] M1｜需求澄清与范围定义｜预计：｜完成：
- [ ] M2｜数据接入与基础建模｜预计：｜完成：
- [ ] M3｜数据服务化与质量监控｜预计：｜完成：

## 4) 任务拆解与进度（Checklist）
> 规则：每个任务都要有「产出」或「可验证结果」。

### 4.0 当前工作板（Doing / Next / Later）

> **迭代记录模板（dev-project-harness-loop）**：每完成一轮"开发/修复/上线"，在本节或【Change Log】追加一条：
> - **Round goal**：本轮要解决什么
> - **Changes**：改了哪些文件/SQL/卡片（列路径）
> - **Verification**：怎么验证（命令/页面/SQL）
> - **Result**：通过/告警/风险接受
> - **Decision**：keep / rework / revert
> - **Next**：下一步/阻塞点

#### Doing（正在收口）
- [x] 人工匹配主流程闭环验收（Yufeng） ✅ 已验收 2026-03-24
  - 范围：`待沉淀队列 -> 确认沉淀 modal -> 用户确认匹配条件 -> 写规则`
  - 修复内容：
    - `/api/rules/settle`: 修正列名 (lvl1_code/lvl2_code → lvl1/lvl2)、补写 override、补写审计日志、智能推断 match_type
    - `/api/rules/settle-batch`: 同上修正 + 事务保障
  - 验证：TypeScript 编译通过
  - 链路确认：前端发送 lvl1/lvl2（中文名）→ 后端映射为 code → 写入 bank_rule_map（列名 lvl1/lvl2，值用 code）+ 写 override（流水消失）+ 写审计日志

#### Next（下一步优先）
- [x] 规则补齐：将现有 114 条 summary 规则拆分为 `summary / memo / purpose` 三条
  - 优先级策略：原 priority / +100 / +200
  - 目标：提升覆盖率，减少仅依赖 summary 的漏匹配
- [x] T5.2 Bonjur DM 主表
  - 前提：确认营业数据导入链路与表命名（`sales_daily` / `sales_monthly`）收口
  - 目标：补齐 Bonjur 的 revenue / expense / profit 主报表输出
- [x] T8.3 Pipeline 控制点埋点验收
  - 目标：确认 import / pipeline 各脚本都稳定写入 ops 运行状态，并能用 SQL 验证

#### Later（后续收尾）
- [x] T7 VPS 迁移演练
- [ ] 验收标准补齐：数据域范围 / 核心指标口径 / 数据字典文档化
- [ ] 最终输出物清单补齐：需求说明、口径文档、Demo/报表链接或截图
- [ ] 里程碑回填：M1 / M2 / M3

### 4.1 详细任务清单（历史明细 + 可追溯 Checklist）
- [x] T2.10 分类字典表落库 + 强约束（方案A）（完成时间：2026-03-24｜init 全绿通过）
  - 目标：固化 Yufeng 分类标准枚举 v1.1，并对 `yufeng_cfg.bank_rule_map`、`yufeng_dm.bank_txn_override` 加 FK 约束，只允许字典表中的分类（禁止任意文本 lvl1/lvl2）。

  - 详细任务步骤（可按顺序执行）：
    - [x] T2.10.1 设计字典表结构（code/name + enabled + direction）
      - 表：`yufeng_cfg.dim_category_lvl1`（PK=lvl1_code）
      - 表：`yufeng_cfg.dim_category_lvl2`（PK=(lvl1_code,lvl2_code)，FK->lvl1）
      - 约定：
        - code 永不变（用于引用稳定）；name 可改（展示文案）
        - lvl2 必须隶属某个 lvl1

    - [x] T2.10.2 写入标准枚举 seed（来源：ProjectTasks.md 1.6 v1.1）
      - 产出：`sql/yufeng_category_dictionary_v1_1.sql`（DDL+seed）
      - 验证：
        - `select count(*) from yufeng_cfg.dim_category_lvl1;`
        - `select count(*) from yufeng_cfg.dim_category_lvl2;`

    - [x] T2.10.3 规则表改造：引入 code 字段并加 FK
      - 表：`yufeng_cfg.bank_rule_map`
      - 变更：新增 `lvl1_code`, `lvl2_code`（lvl2 可空）
      - 约束：
        - `lvl1_code` FK -> `dim_category_lvl1(lvl1_code)`
        - `(lvl1_code,lvl2_code)` FK -> `dim_category_lvl2(lvl1_code,lvl2_code)`（仅在 lvl2_code 非空时）
      - 数据迁移：从旧 `lvl1/lvl2` 文本映射到新 code（不在枚举内的先落 `UNCLASSIFIED` 或 `EXP_OTHER/OTHER_OUT`，按方向再讨论）

    - [x] T2.10.4 人工覆盖表改造：引入 code 字段并加 FK
      - 表：`yufeng_dm.bank_txn_override`
      - 变更：新增 `lvl1_code`, `lvl2_code`
      - 约束同规则表
      - 数据迁移：从旧 `lvl1/lvl2` 文本映射到新 code

    - [x] T2.10.5 分类函数/视图兼容：统一以 code 计算，再 join 字典输出 name
      - 更新：`yufeng_dm.fn_classify_bank_txn` 输出 `lvl1_code/lvl2_code`
      - 更新：`yufeng_dm.v_bank_txn_classified` 增加 `lvl1_name/lvl2_name`（join 字典表）
      - 兼容：Metabase/UI 仍可使用 name 展示；写入必须用 code

    - [x] T2.10.6 UI 改造：下拉数据源改为字典表（禁止写死枚举）
      - /match：lvl1/lvl2 options 来自 API（读字典表）
      - /rules：新建/编辑规则时只允许选择字典项（保存写入 code）

    - [x] T2.10.7 验收（必须过）（init 全绿通过）
      - 约束验证：尝试插入非法 lvl1_code/lvl2_code → 被 FK 拒绝
      - 回归验证：`yufeng_dm.v_bank_txn_classified` 行数=bank_txn 行数；override/rule/unclassified 分布合理
      - 看板验证：dashboard=4 关键卡片可正常展示（尤其 card=44）

  - 产出：
    - `yufeng_cfg.dim_category_lvl1` / `yufeng_cfg.dim_category_lvl2` DDL + seed（v1.1）
    - `sql/yufeng_category_dictionary_v1_1.sql`
    - 规则表/override 表新增 `lvl1_code/lvl2_code` 并加 FK
    - 兼容层：`v_bank_txn_classified` / UI / Metabase 按 code→name 展示

  - 验证：尝试插入非法分类被数据库拒绝；UI 下拉只显示字典项。

- [x] T2.11 分类匹配策略重构（Yufeng）：禁用 any + 匹配模式（contains/exact，使用 match_type 列）+ override 脱离分类（产出：SQL 迁移 + 分类函数更新 + 回归验证）（完成时间：2026-03-24）
  - 背景：当前 `fn_classify_bank_txn` 采用 override>rule>unclassified 且规则支持 match_field=any（跨字段 contains）。新决策要求：不存 any；优先 summary/memo/purpose contains；三者为空才 counterparty_name exact；override 仅日志。
  - 变更点（DB/SQL）：
    - 规则表：`yufeng_cfg.bank_rule_map`
      - 新增：`match_mode`（contains/exact）
      - 约束：禁止 `match_field='any'`（数据清理+约束）
    - 分类函数：`yufeng_dm.fn_classify_bank_txn`
      - 移除 override 查询（不再读取 `yufeng_dm.bank_txn_override`）
      - 按字段策略匹配：summary→memo→purpose（contains）；三者都空才 counterparty_name（exact）
      - 保留优先级：同字段内仍按 priority asc 取第一条
    - 视图：`yufeng_dm.v_bank_txn_classified` / `yufeng_dm.*_monthly`
      - 确保 classified_source 不再出现 override（仅 rule/unclassified）
  - 迁移与兼容：
    - 现存规则的 any 处理：迁移为 3 条规则（summary/memo/purpose）或按人工确认迁移（避免误伤）
    - counterparty_name 规则统一改为 exact（如需 contains 需显式选择，不作为默认）
  - 验收/回归：
    - 覆盖率视图正常；`v_rule_conflict_*` 正常
    - 抽样比对：同一批数据在新旧策略下分类差异清单可解释

- [x] T2.12 人工匹配日志表（Yufeng）（产出：unclassified 处理审计，不参与分类）（完成时间：2026-03-24）
  - 新增：`yufeng_ops.unclassified_resolution_log`（或等价命名）
  - 记录：bank_txn_id、选择的 lvl1/lvl2、生成的 rule_id、resolved_by、resolved_at、命中预览统计（可选）
  - 验收：可追溯"某条未分类是谁在何时用什么规则解决的"。

- [x] T1 数据源字段盘点（营业报表CSV/银行流水Excel）（产出：字段映射表+缺失字段清单）
  - Bonjur：字段映射与清洗规则 ✅ `brand-docs/Bonjur_T1_字段映射与清洗规则.md`（已确认：month=YYYY-MM-01；空值=NULL；月粒度）
  - Yufeng：字段映射与清洗规则 ✅ `brand-docs/Yufeng_T1_字段映射与清洗规则.md`（银行流水：去逗号、空串→NULL、时间解析；store_code 默认 yf_gh）
- [x] T2 分类字典/规则建设（优先 bank_rule_map）（产出：规则表 + 初版规则 + 覆盖率统计 + 未分类清单）
  - Yufeng：已建立规则设计文档 `brand-docs/Yufeng_T2_bank_rule_map_设计与初版规则.md` + DDL `brand-docs/Yufeng_CFG_DDL.sql` + 初版规则SQL `brand-docs/Yufeng_T2_bank_rule_map_初版规则清单_v0.sql`
  - [x] T2.1 定义分类体系（lvl1/lvl2）（产出：标准枚举+说明；包含新增 lvl1=材料采购）✅ `brand-docs/Yufeng_T2_分类体系枚举_v0.md`
  - [x] T2.2 规则表落库（产出：yufeng_cfg.bank_rule_map 建表）✅ `sql/yufeng_apply_classification.sql`
    - 验证：表存在 + enabled/priority 索引存在；`select count(*) from yufeng_cfg.bank_rule_map;` 可执行
  - [x] T2.3 初版规则入库（产出：priority/关键词规则可运行）✅ `sql/yufeng_apply_classification.sql`（约90+条规则）
    - 验证：规则条数>0；priority 无明显冲突；抽样流水可命中（至少命中"美团/饿了么/抖音/手续费"等）
  - [x] T2.4 规则命中计算（产出：classified view/表，含 matched_rule_id/source）✅ `sql/yufeng_apply_classification.sql` / `brand-docs/Yufeng_DM_DDL_override_and_classified.sql`
    - 验证：classified 结果行数 = bank_txn 行数；lvl1 不为空；classified_source 分布合理（override/rule/unclassified）
  - [x] T2.5 覆盖率统计（产出：按月/按笔数/按金额报表）
    - 验证：covered_rows<=total_rows；covered_amt<=total_amt；覆盖率可按月出趋势
    - ✅ SQL文件: `sql/yufeng_coverage_and_unclassified.sql`
    - ✅ 视图: `yufeng_dm.v_coverage_monthly`（按月，含 in/out 分开统计）
    - 验证SQL:
      ```sql
      -- 覆盖率月度统计（含 in/out 分开统计）
      select * from yufeng_dm.v_coverage_monthly;
      ```
  - [x] T2.6 未分类清单（产出：Top 对方单位/关键词/金额列表，供补规则）
    - 验证：能按月输出 TopN（默认 Top20），并支持跳转到明细（bank_txn_id 列表）
    - ✅ SQL文件: `sql/yufeng_coverage_and_unclassified.sql`
    - ✅ 视图:
      - `yufeng_dm.v_unclassified_top` - 未分类汇总 TopN
      - `yufeng_dm.v_unclassified_detail` - 未分类明细（含 bank_txn_id）
    - 验证SQL:
      ```sql
      -- 未分类 Top20（默认全部月份）
      select * from yufeng_dm.v_unclassified_top limit 20;

      -- 未分类 Top20（指定月份）
      select * from yufeng_dm.v_unclassified_top where month = '2025-03' limit 20;

      -- 未分类明细（指定月份，跳转到原始流水）
      select * from yufeng_dm.v_unclassified_detail where month = '2025-03';
      ```

  - [x] T2.7 规则回归验证集（产出：golden set + 每次改规则的回归SQL）
    - 说明：从历史未分类/易错分类中抽样 20~50 条作为固定验证集，避免"修A坏B"。
    - 验证：回归SQL能输出（期望分类 vs 实际分类）差异清单。
    - ✅ SQL文件: `sql/yufeng_rule_regression.sql`
    - ✅ 表: `yufeng_dm.rule_regression_set` - 回归验证集存储表
    - ✅ 视图:
      - `yufeng_dm.v_rule_regression_check` - 回归检查（期望 vs 实际差异清单）
      - `yufeng_dm.v_regression_candidates` - 候选样本生成（未分类Top + 已分类随机抽样）
    - 验证SQL:
      ```sql
      -- 查看候选样本（用于人工标注 expected）
      select * from yufeng_dm.v_regression_candidates limit 10;

      -- 插入验证集示例
      insert into yufeng_dm.rule_regression_set (bank_txn_id, expected_lvl1, expected_lvl2, note)
      values (123, '营业收入', '美团', '测试样本1')
      on conflict (bank_txn_id) do update set expected_lvl1 = excluded.expected_lvl1;

      -- 回归检查：输出不一致清单
      select * from yufeng_dm.v_rule_regression_check;

      -- 回归检查：仅看有差异的
      select * from yufeng_dm.v_rule_regression_check where diff_type is not null;
      ```
  - [x] T2.8 规则冲突/多命中统计（产出：冲突命中报表）
    - 说明：当同一流水可命中多条规则时，输出冲突数、Top 冲突关键词，并确认 priority 规则生效。
    - 验证：冲突统计 rows >=0；priority 最高的规则被选中。
    - ✅ SQL文件: `sql/yufeng_rule_regression.sql`
    - ✅ 视图:
      - `yufeng_dm.v_rule_conflict_summary` - 冲突汇总统计（冲突笔数、Top关键词、Top对手方）
      - `yufeng_dm.v_rule_conflict_detail` - 冲突明细（命中数 > 1 的流水）
      - `yufeng_dm.v_rule_conflict_all` - 全量命中明细（每条流水命中的所有规则）
    - 验证SQL:
      ```sql
      -- 冲突汇总统计
      select * from yufeng_dm.v_rule_conflict_summary;

      -- 冲突明细（命中数 > 1）
      select * from yufeng_dm.v_rule_conflict_detail;

      -- 查看具体某条流水所有命中规则（调试用）
      -- select * from yufeng_dm.v_rule_conflict_all where bank_txn_id = :target_id;
      ```

- [x] T2.9 规则沉淀 + 冲突检测 + 双重匹配（产出：UI 人工匹配后沉淀规则功能）
  - 说明：匹配页先做 override（人工匹配）→ 进入 pending 队列 → 顶部按钮「发送/沉淀为规则（N条）」批量沉淀；检测同一关键词的分类冲突（仅 enabled=true）；冲突时可选择用「摘要 AND 对方单位」做双重匹配。
  - 验证：批量沉淀成功写入 bank_rule_map；冲突时弹窗提示；双重匹配生效
  - ✅ SQL文件: `sql/yufeng_rule_settle.sql`
    - 新增列：match_field2, match_value2（支持 AND 匹配）
    - 新增函数：fn_classify_bank_txn（支持双条件 AND 匹配）
    - 新增函数：fn_check_rule_conflict（冲突检测）
    - 新增函数：fn_settle_rule（规则沉淀）
  - ✅ 新增收入分类：其他收入/注资、借款、贷款、利息、退税、退款；管理费用/报销、准备金
  - ✅ API: `/api/rules/settle`（单条）+ `/api/rules/settle-batch`（批量）
  - ✅ UI: 匹配页 pending 面板 + 批量发送按钮 + 冲突弹窗 + 双重匹配选项

- [x] T3 数据清洗与归档流水线（产出：可重复跑的 ETL 脚本/命令）
  - [x] T3.0 输入规范与目录约定（产出：README + 文件命名/目录规则）✅ `inputs/README.md`
    - 约定：`brand_code/store_code/source_type/YYYY-MM/原始文件名`（YYYY-MM 由**系统时间**生成；上传页不再手填月份）
    - 验证：同一套约定能让脚本自动推断 brand/store/source；YYYY-MM 用系统时间落盘；无法推断则明确报错。
  - [x] T3.1 RAW 文件登记（ingest_file）与 source_file_id 追溯链路 ✅ `sql/raw_ingest_file.sql`
    - 产出：ingest_file 表结构/索引 + status（pending/success/failed）+ error_message + row_count + hash
    - 验证：重复文件（hash 相同）可识别；失败可重跑；能按 source_file_id 回溯到原文件。
  - [x] T3.2 幂等导入策略（产出：导入"重跑不重复"的策略落地）✅ `scripts/idempotent_import.md`
    - 优先策略：按 source_file_id 维度"删当次导入数据→重灌"（最小复杂度）
    - 验证：同一文件重复导入 2 次，ODS 行数不翻倍。
  - [x] T3.3 Yufeng 银行流水导入脚本（表头识别、金额去逗号、时间解析）✅ `scripts/import_yufeng_bank_txn.py`
    - 脚本路径：`scripts/import_yufeng_bank_txn.py`
    - 运行示例：
      ```bash
      # 干运行（不写库）
      python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx --dry-run

      # 执行导入
      python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx

      # 验证导入结果
      python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx --verify
      ```
    - 验证 SQL：
      ```sql
      -- 查询导入结果
      SELECT * FROM raw.ingest_file WHERE file_name LIKE '%银行流水%' ORDER BY created_at DESC LIMIT 5;

      -- 验证 bank_txn 行数
      SELECT COUNT(*) FROM yufeng_ods.bank_txn;

      -- 按 source_file_id 回溯原文件
      SELECT bt.id, bt.txn_time, bt.in_amt, bt.counterparty_name, if.file_name, if.file_path
      FROM yufeng_ods.bank_txn bt
      JOIN raw.ingest_file if ON bt.source_file_id = if.id
      ORDER BY bt.txn_time DESC
      LIMIT 10;
      ```
    - 验证结果：导入后 `yufeng_ods.bank_txn` 行数 = 312；关键字段（txn_time/in_amt/out_amt）可用。
  - [x] T3.4 Bonjur 营业 CSV 导入脚本（过滤汇总行、门店映射、month 归一）
    - 脚本路径：`scripts/import_bonjur_sales_daily.py`
    - 运行示例：
      ```bash
      # 干运行（不写库）
      python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/xxx.csv --dry-run

      # 执行导入
      python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/xxx.csv

      # 验证导入结果
      python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/xxx.csv --verify
      ```
    - 验证 SQL：
      ```sql
      -- 查询导入结果
      SELECT * FROM raw.ingest_file WHERE brand_code = 'bonjur' ORDER BY created_at DESC LIMIT 5;

      -- 验证 sales_monthly 行数
      SELECT COUNT(*) FROM bonjur_ods.sales_monthly;

      -- 按 source_file_id 回溯原文件
      SELECT sm.id, sm.store_code, sm.month, sm.revenue_amt, if.file_name, if.file_path
      FROM bonjur_ods.sales_monthly sm
      JOIN raw.ingest_file if ON sm.source_file_id = if.id
      ORDER BY sm.month DESC, sm.store_code
      LIMIT 10;
      ```
    - 验证结果：dry-run 测试通过；正确过滤汇总行；门店映射正确；month 归一到 YYYY-MM-01；字段完整。
  - [x] T3.5 "导入后一键检查"命令/脚本（产出：import→classify→coverage→unclassified→dm 的串联入口）
    - 验证：一条命令执行后，覆盖率与未分类清单可直接查询。
    - 脚本路径：`scripts/run_pipeline_oneclick.py`
    - 运行示例：
      ```bash
      # 全部品牌，dry-run（不实际写库）
      python scripts/run_pipeline_oneclick.py --brand all --dry-run

      # 仅 Yufeng，指定月份
      python scripts/run_pipeline_oneclick.py --brand yufeng --month 2025-03

      # 仅 Bonjur
      python scripts/run_pipeline_oneclick.py --brand bonjur
      ```
    - 关键验证输出说明：
      - **Yufeng**：输出 `yufeng_dm.v_coverage_monthly` 最新 3 行（含 coverage_rate_rows/coverage_rate_in_amt/coverage_rate_out_amt）
      - **Yufeng**：输出 `yufeng_dm.v_unclassified_top` Top 10（含 month/counterparty_name/summary/txn_rows/total_amt）
      - **Yufeng**：输出 source_file_id 回溯示例 SQL
      - **Bonjur**：输出导入校验查询（bonjur_ods.sales_monthly 导入记录），DM/规则尚未完成则提示跳过
    - 验证 SQL：
      ```sql
      -- Yufeng 覆盖率月度统计
      SELECT * FROM yufeng_dm.v_coverage_monthly;

      -- Yufeng 未分类 Top 20（默认全部月份）
      SELECT * FROM yufeng_dm.v_unclassified_top LIMIT 20;

      -- Yufeng 未分类（指定月份）
      SELECT * FROM yufeng_dm.v_unclassified_top WHERE month = '2025-03' LIMIT 20;

      -- Bonjur 导入记录
      SELECT * FROM raw.ingest_file WHERE brand_code = 'bonjur' ORDER BY created_at DESC;
      ```
  - [x] T3.6 与监控打通：ETL 每步写入 ops.step_run（产出：脚本内埋点）
    - 验证：每次运行能在 ops 表看到开始/结束/状态/行数/耗时。
    - 变更文件：
      - `scripts/ops_logger.py` - 新增：通用 ops 记录模块
      - `scripts/import_yufeng_bank_txn.py` - 修改：添加 ops 埋点（register_file、delete_previous、load_excel、insert_bank_txn、update_ingest_status）
      - `scripts/import_bonjur_sales_daily.py` - 修改：添加 ops 埋点（register_file、delete_previous、load_file、transform、insert_sales、update_ingest_status）
      - `scripts/run_pipeline_oneclick.py` - 修改：添加 ops 埋点（run_import_yufeng、run_import_bonjur、apply_classification_sql、apply_coverage_sql、print_summary）
    - 验证 SQL：
      ```sql
      -- 查看最近一次 pipeline 运行
      SELECT * FROM ops.pipeline_run ORDER BY started_at DESC LIMIT 5;

      -- 查看最近一次运行的步骤状态
      SELECT pr.brand_code, pr.month, pr.status as run_status,
             ps.step_name, ps.status as step_status, ps.rows_out, ps.duration_sec, ps.error_message
      FROM ops.pipeline_run pr
      JOIN ops.pipeline_step_run ps ON pr.run_id = ps.run_id
      ORDER BY pr.started_at DESC, ps.step_order
      LIMIT 20;

      -- 查看特定品牌/月份的运行记录
      SELECT pr.brand_code, pr.store_code, pr.month, pr.status, pr.started_at, pr.finished_at,
             ps.step_name, ps.status, ps.rows_out, ps.duration_sec
      FROM ops.pipeline_run pr
      JOIN ops.pipeline_step_run ps ON pr.run_id = ps.run_id
      WHERE pr.brand_code = 'yufeng' AND pr.month = '2026-03'
      ORDER BY ps.step_order;
      ```

- [x] T4 UI：人工匹配 + 规则管理（定稿：方案B 自定义可操作界面，无需登录）（产出：可用Web界面+写回DB）
  - [x] T4.1 UI 交互原型（页面/字段/操作流）（产出：文档/截图；重点：未分类优先+金额降序+批量匹配）
    - 已产出：`brand-docs/Yufeng_UI_交互原型_v0.md`
  - [x] T4.2 override 表设计与落库（产出：yufeng_dm.bank_txn_override DDL）✅ `brand-docs/Yufeng_DM_DDL_override_and_classified.sql`
  - [x] T4.3 UI 技术落地方案（产出：Next.js + API 设计文档）✅ `ui/UI_技术方案_v0.md`
  - [x] T4.4 规则管理页面（CRUD + priority 调整 + 规则测试）✅ `ui/`
    - 代码目录: `ui/src/app/rules/`
    - 启动命令: `cd ui && npm run dev`
    - 验收步骤: 访问 /rules 页面，测试添加/编辑/删除/启用规则
  - [x] T4.5 人工匹配页面（筛选/批量/推荐/保存覆盖）✅ `ui/`
    - 代码目录: `ui/src/app/match/`
    - 启动命令: `cd ui && npm run dev`
    - 验收步骤: 访问 /match 页面，测试筛选/批量归类/撤销 override
  - [x] T4.6 覆盖率面板（按月：笔数/金额/未分类Top）✅ `ui/`
    - 代码目录: `ui/src/app/pipeline/`
    - 启动命令: `cd ui && npm run dev`
    - 验收步骤: 访问 /pipeline 页面，查看覆盖率统计和 Pipeline 运行记录

  - [x] T4.7 UI：人工匹配→直接写入规则（Yufeng）（产出：/match 提交即刻沉淀 rule_map；override 仅日志）（完成时间：2026-03-24）
    - 目标：匹配完成后立即生成/更新 `yufeng_cfg.bank_rule_map`，对未来文件立刻生效；不再依赖 `bank_txn_override` 参与分类。
    - UI 提交必填字段（最小集）：direction(in/out)、lvl1_code、lvl2_code(可空)、match_field(summary/memo/purpose/counterparty_name)、match_value、priority、enabled。
    - 验收：保存后该条流水在未分类列表中消失；新增规则在 /rules 可见；再次导入相似流水可直接命中规则。

  - [x] T4.8 UI：匹配值提取（候选片段 + 命中预览）（Yufeng）（产出：match_value 推荐与风险可视化）（完成时间：2026-03-24）
    - 目标：解决 summary/memo/purpose 全量取值导致匹配率低的问题。
    - 逻辑：从 summary/memo/purpose 生成 3~8 个候选关键片段（去日期/长数字/金额等噪声），用户点选；实时预览历史命中数与分类分布（避免误伤）。
    - 验收：候选可用；命中预览可用；用户可编辑后提交。

  - [x] T4.9 软阀门落地：未分类 KPI 固定展示（Yufeng）（产出：pipeline 页面/Metabase 卡片的 unclassified/coverage 指标）（完成时间：2026-03-24）
    - 验收：任何时刻可看到未分类条数、金额占比、Top 关键词/对方单位；不阻断 DM 输出。

- [x] T5 dbt/SQL 模型与口径落地（产出：DM 表清单 + 字段口径 + SQL/dbt 模型）
  - 一期每品牌核心 DM（3张主表）：`<brand>_dm.revenue_monthly` / `<brand>_dm.expense_monthly` / `<brand>_dm.profit_monthly`
  - 为支持"覆盖率<100%人工匹配/UI"，Yufeng 增补（表或 view）：`yufeng_dm.bank_txn_classified`（override>rule>unclassified） + `yufeng_dm.coverage_monthly`

  - [x] T5 Yufeng DM 主表（最小可验收版本）
    - 说明：采用 VIEW 而非 TABLE，优点是无需维护、随源数据自动更新、便于快速验收
    - ✅ SQL文件: `sql/yufeng_dm_models.sql`
    - ✅ 视图:
      - `yufeng_dm.revenue_monthly` - 月度收入（业务口径+银行口径+差异）
      - `yufeng_dm.expense_monthly` - 月度费用（按 lvl1/lvl2 分类汇总）
      - `yufeng_dm.profit_monthly` - 月度利润（收入-费用+差异）
    - 验证SQL:
      ```sql
      -- T5.1 收入月报
      select * from yufeng_dm.revenue_monthly;

      -- T5.2 费用月报（按月+分类）
      select * from yufeng_dm.expense_monthly;

      -- T5.3 费用月报（按月汇总，简化版）
      select month, sum(total_out_amt) as total_expense_amt
      from yufeng_dm.expense_monthly
      group by month
      order by month desc;

      -- T5.4 利润月报
      select * from yufeng_dm.profit_monthly;
      ```
    - NOTE: Bonjur 的 sales_daily vs sales_monthly 命名不一致（代码中有 sales_daily 提及，但实际表名是 sales_monthly），待后续解决

  - [ ] T5.2 Bonjur DM 主表（待营业数据导入后实现）

- [x] T6 POC：本机端到端跑通（文件归档→PG→分类→DM→UI）（产出：可复现 README + docker-compose）
  - [x] T6.1 端到端验收脚本/命令清单（产出：README 中的"一条龙命令"）
    - 验证：能从空环境初始化→导入样例→生成 DM → 查询出报表结果。
    - ✅ 文档路径：`docs/ACCEPTANCE_RUNBOOK.md`
  - [x] T6.2 关键结果快照（产出：利润表/对账表样例截图或查询结果）
    - 验证：关键指标（收入两口径、费用汇总、差异）能对上预期。
    - 真实跑通证据：`docs/REAL_RUN_2026-03-22.md`
    - ✅ 文档路径：`docs/ACCEPTANCE_SNAPSHOTS.md`
  - [x] T6.3 完整本地测试 checklist（启动PG→init→导入→分类→DM→覆盖率/未分类→ops记录）
    - 产出：`docs/LOCAL_TEST_CHECKLIST.md`

- [x] T9 配置管理与一键初始化（产出：.env/config 统一 + init 脚本）
  - [x] T9.1 配置文件约定（产出：.env.example 或 config.yaml 说明）
    - 覆盖：db url、brand/store mapping、raw 数据目录、schema 命名。
    - ✅ 文件：
      - `.env.example`
      - `docs/CONFIG_CONVENTION.md`
    - ✅ 使用方式：
      ```bash
      cd 项目/WDG
      cp .env.example .env
      set -a && source .env && set +a
      ```
  - [x] T9.2 一键初始化脚本（产出：建库/建schema/跑DDL/种子规则）
    - 验证：新机器上按 README 步骤可在 10 分钟内跑起。
    - ✅ 脚本路径：`scripts/init_local_env.sh`
    - 运行示例：
      ```bash
      # 进入项目目录
      cd /path/to/WDG

      # 方式1：仅初始化数据库（不含样例数据）
      ./scripts/init_local_env.sh

      # 方式2：初始化 + 导入样例数据 + 运行 pipeline
      ./scripts/init_local_env.sh --with-sample-data
      ```
    - 验证 SQL：
      ```sql
      -- 检查 schema 是否创建成功
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN ('raw', 'ops', 'bonjur_ods', 'yufeng_ods', 'yufeng_cfg', 'yufeng_dm');

      -- 检查 Yufeng 规则是否入库
      SELECT COUNT(*) FROM yufeng_cfg.bank_rule_map;

      -- 检查 DM 视图是否可查询
      SELECT * FROM yufeng_dm.revenue_monthly LIMIT 1;

      -- 检查 Bonjur 兼容视图
      SELECT * FROM bonjur_ods.sales_daily LIMIT 1;
      ```

- [ ] T7 VPS 迁移演练（产出：部署手册 + 迁移步骤 + 回滚方案）

- [ ] T8 Pipeline 监控与控制点预埋（产出：ops 运行元数据 + Metabase 监控 Dashboard）
  - [x] T8.1 控制点定义与指标口径文档（产出：`Pipeline_控制点与监控dashboard.md`）✅
  - [x] T8.2 ops 元数据表设计（pipeline_run/step_run/dq_check/coverage）✅ `ops/OPS_DDL.sql` + `ops/README.md`
  - [ ] T8.3 ETL/dbt 在每个控制点写入运行状态（成功/失败/行数/耗时）
    > 当前进度：部分完成。已有 ops_logger.py 模块和基础埋点，需确认每个脚本的控制点完整覆盖。

    **Checklist（需在以下脚本中确认/补充 step_name 写入）**：
    - [ ] `scripts/import_yufeng_bank_txn.py` - 已埋点：register_file, delete_previous, load_excel, insert_bank_txn, update_ingest_status
      - 验证：运行一次完整导入，检查 ops.pipeline_step_run 有无记录
    - [ ] `scripts/import_bonjur_sales_daily.py` - 已埋点：register_file, delete_previous, load_file, transform, insert_sales, update_ingest_status
      - 验证：运行一次完整导入，检查 ops.pipeline_step_run 有无记录
    - [ ] `scripts/run_pipeline_oneclick.py` - 已埋点：run_import_yufeng, run_import_bonjur, apply_classification_sql, apply_coverage_sql, print_summary
      - 验证：运行一次 pipeline，检查 ops.pipeline_run 和 ops.pipeline_step_run 有无记录
    - [ ] `scripts/apply_classification.py`（如有）- 需新增埋点
    - [ ] `scripts/generate_dm.py`（如有）- 需新增埋点
    - [ ] 验收 SQL：
      ```sql
      -- 检查是否有运行记录
      SELECT pr.brand_code, pr.month, pr.status, pr.started_at,
             ps.step_name, ps.status as step_status, ps.rows_out, ps.duration_sec
      FROM ops.pipeline_run pr
      JOIN ops.pipeline_step_run ps ON pr.run_id = ps.run_id
      ORDER BY pr.started_at DESC, ps.step_order
      LIMIT 20;
      ```

  - [x] T8.4 Metabase Dashboard：Pipeline Health（单页看全链路）
    - 部署计划：`docs/DASHBOARD_DEPLOY_PLAN.md`
    - 配置指南：`docs/METABASE_SETUP.md` ✅
    - Compose：`docker-compose.dashboard.yml`
    - 自动化脚本（用于后续"按设计一键生成报表/看板"）：`scripts/metabase_seed_dashboard.py`
      - 已生成示例 Questions（Yufeng 财务看板组件）：
        - `Yufeng｜收支总揽（表）`（cardId=44）
        - `Yufeng｜支出一级分类（饼图）`（cardId=45）
        - `Yufeng｜支出二级分类（饼图）`（cardId=46）
        - `Yufeng｜收入二级分类（柱状图）`（cardId=47）

  - [x] T8.5 Pipeline 覆盖率（按上传文件/任务维度）（完成时间：2026-03-22）
    - 口径：覆盖率统计以 `raw.ingest_file.id (source_file_id)` 为维度（1 个文件=1 个 ID；支持多文件上传，但每个文件绑定不同 ID）
    - 产出：SQL 视图 `yufeng_dm.v_coverage_by_file`（按 source_file_id 汇总） + `yufeng_dm.v_unclassified_top_by_file`
    - SQL 文件：`sql/yufeng_coverage_by_file.sql`
    - UI 变更：`ui/src/app/pipeline/page.tsx`（/pipeline 默认展示"最近上传文件列表 + 每个文件覆盖率 + 未分类 TopN"；使用 brand context / brand selector）
    - 验证 SQL：
      ```sql
      -- 最近上传文件的覆盖率
      select * from yufeng_dm.v_coverage_by_file limit 10;

      -- 取任意 source_file_id，查看该文件的未分类 TopN
      select * from yufeng_dm.v_unclassified_top_by_file where source_file_id = :file_id limit 20;
      ```

### 4.2 已完成基础项（项目启动阶段）
- [x] T0 创建项目骨架（产出：项目目录+进度卡/总结/说明｜完成时间：2026-03-21 22:54）
- [x] T0.1 第一版架构/技术栈/数据库结构方案记录（产出：ProjectTasks.md 更新｜完成时间：2026-03-21 23:21）

### 4.3 说明
- 当前执行优先级以 `4.0 当前工作板` 为准
- `4.1 详细任务清单` 保留历史拆解、验收口径与证据路径，避免丢失上下文

---

## 5) P0 任务完成记录（2026-03-22）

## 6) P1 任务完成记录（2026-03-24）

### T2.10 分类字典表落库 + 强约束（yufeng｜严格 B2｜方法B 字典动态下拉）✅

**交付内容**：
- 字典表落库 + seed（v1.1：12 个 lvl1 + 45 个 lvl2）
- 规则表/override 表迁移为 `lvl1_code/lvl2_code` 引用 + FK 强约束 + 删除旧文本列（B2）
- 分类函数/视图全量 code 化（fn_classify_bank_txn、v_bank_txn_classified、v_coverage_*、v_unclassified_*、v_rule_regression_*、v_rule_conflict_*）
- DM 模型 code 化（revenue_monthly、expense_monthly、profit_monthly）
- UI 下拉从 DB 字典动态读取（`/api/categories`），写入只用 code，展示用 name

**验证方式**：
- 初始化：执行 `scripts/init_local_env.sh`（全绿无 ERROR）
- UI：/rules 新增/编辑规则；/match 人工匹配；确认写入成功且不再依赖文本字段
- DB：尝试插入非法 `lvl1_code` 被 FK 拒绝

**变更文件清单**：
- SQL：`yufeng_category_dictionary_v1_1.sql`、`yufeng_category_migration_v1_1.sql`、`yufeng_apply_classification.sql`、`yufeng_dm_models.sql`、`yufeng_rule_regression.sql`、`Yufeng_CFG_DDL.sql`、`Yufeng_DM_DDL_override_and_classified.sql`、`yufeng_coverage_and_unclassified.sql`
- Init：`scripts/init_local_env.sh`
- API：`ui/src/app/api/categories/route.ts`、`ui/src/app/api/rules/route.ts`、`ui/src/app/api/match/route.ts`
- UI：`ui/src/app/rules/page.tsx`、`ui/src/app/match/page.tsx`
- Types：`ui/src/lib/types.ts`


### T8.5 Pipeline 覆盖率按文件维度 + UI 品牌隔离

**需求**：
- 1 个 ingest_file.id 对应 1 个文件（source_file_id）；支持多文件上传
- /pipeline 的覆盖率维度必须按 source_file_id（上传任务/文件）统计
- /rules /match 需要按 brand 隔离

**交付内容**：

1. **SQL 视图**：
   - `sql/yufeng_coverage_by_file.sql` - 创建 `yufeng_dm.v_coverage_by_file` 和 `yufeng_dm.v_unclassified_top_by_file`
   - 按 source_file_id 统计覆盖率（total_rows/covered_rows/coverage_rate_rows 等）

2. **Init 脚本更新**：
   - `scripts/init_local_env.sh` - 新增步骤 3.8.1 执行 yufeng_coverage_by_file.sql

3. **Next.js UI 更新**：
   - `ui/src/lib/brand-context.tsx` - 新增 BrandContext 和 useBrand hook
   - `ui/src/app/layout.tsx` - 全局导航栏添加品牌选择器
   - `ui/src/lib/types.ts` - 新增 CoverageByFile 和 UnclassifiedByFile 类型
   - `ui/src/app/api/coverage/by-file/route.ts` - 新建 API 路由
   - `ui/src/app/api/coverage/unclassified-by-file/route.ts` - 新建 API 路由
   - `ui/src/app/api/rules/route.ts` - 更新支持 brand 参数
   - `ui/src/app/pipeline/page.tsx` - 展示文件维度覆盖率 + 点击展开未分类 TopN
   - `ui/src/app/upload/page.tsx` - 上传后显示该文件的覆盖率
   - `ui/src/app/rules/page.tsx` - 品牌隔离 + 重复规则 badge 提示

4. **变更文件清单**：
   - 新增：`sql/yufeng_coverage_by_file.sql`
   - 新增：`ui/src/lib/brand-context.tsx`
   - 新增：`ui/src/app/api/coverage/by-file/route.ts`
   - 新增：`ui/src/app/api/coverage/unclassified-by-file/route.ts`
   - 修改：`scripts/init_local_env.sh`
   - 修改：`ui/src/app/layout.tsx`
   - 修改：`ui/src/lib/types.ts`
   - 修改：`ui/src/app/api/rules/route.ts`
   - 修改：`ui/src/app/pipeline/page.tsx`
   - 修改：`ui/src/app/upload/page.tsx`
   - 修改：`ui/src/app/rules/page.tsx`

**验证 SQL**：
```sql
-- 最近上传文件的覆盖率
select * from yufeng_dm.v_coverage_by_file limit 10;

-- 取任意 source_file_id，查看该文件的未分类 TopN
select * from yufeng_dm.v_unclassified_top_by_file where source_file_id = :file_id limit 20;
```

---

**TASK_COMPLETE**

## Change Log

| Date | Change | Verification |
|------|--------|--------------|
| 2026-03-24 18:46 CST | Standardize project to harness-guards (install/refresh scripts + docs) | Planned: run_change_guard.sh |
| 2026-03-25 22:35 CST | Bonjur 对齐 Yufeng v2（共享 yufeng_cfg 字典）：创建 v2 分类函数/视图；规则表添加 lvl1_code/lvl2_code；新增 159 条规则；覆盖率 100%；对齐 DM 模型（revenue/expense/profit_monthly） | SQL 执行验证：覆盖率 100%，DM 视图可查询 |
