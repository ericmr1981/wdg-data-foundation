# 任务进度卡｜WDG Data Foundation

## 0) 基本信息
- **ID**: WDG Data Foundation
- **优先级**: P1
- **负责人(Agent)**: polo_engineer
- **提出人**: Eric
- **创建时间**: 2026-03-21 22:54
- **截止时间**: （可空）
- **相关链接/资料**:
  - （待补充）

## 1) 背景与目标（Why/What）
- **背景**: 一期目标聚焦“营业 + 财务”T+1 报表自动生成。当前数据以 Excel 为主，口径分散、对账困难（业务口径 vs 银行口径存在差异），需要沉淀可追溯的加工链路与统一口径。
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
  - **银行流水单**（Excel）：现金流口径明细（转入/转出/余额/摘要/附言/对方单位等；可能**不自带“费用明细K分类”**，需规则/字典自动归类）
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
- **数据治理补充（新增需求）**：当自动分类覆盖率 <100% 时，需提供 **UI 人工匹配** 与 **规则管理 UI**（查看/编辑/启停/优先级调整），并将人工结果写回数据库（override 优先于规则）。

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

### 4.1 To Do
- [x] T1 数据源字段盘点（营业报表CSV/银行流水Excel）（产出：字段映射表+缺失字段清单）
  - Bonjur：字段映射与清洗规则 ✅ `brand-docs/Bonjur_T1_字段映射与清洗规则.md`（已确认：month=YYYY-MM-01；空值=NULL；月粒度）
  - Yufeng：字段映射与清洗规则 ✅ `brand-docs/Yufeng_T1_字段映射与清洗规则.md`（银行流水：去逗号、空串→NULL、时间解析；store_code 默认 yf_gh）
- [x] T2 分类字典/规则建设（优先 bank_rule_map）（产出：规则表 + 初版规则 + 覆盖率统计 + 未分类清单）
  - Yufeng：已建立规则设计文档 `brand-docs/Yufeng_T2_bank_rule_map_设计与初版规则.md` + DDL `brand-docs/Yufeng_CFG_DDL.sql` + 初版规则SQL `brand-docs/Yufeng_T2_bank_rule_map_初版规则清单_v0.sql`
  - [x] T2.1 定义分类体系（lvl1/lvl2）（产出：标准枚举+说明；包含新增 lvl1=材料采购）✅ `brand-docs/Yufeng_T2_分类体系枚举_v0.md`
  - [x] T2.2 规则表落库（产出：yufeng_cfg.bank_rule_map 建表）✅ `sql/yufeng_apply_classification.sql`
    - 验证：表存在 + enabled/priority 索引存在；`select count(*) from yufeng_cfg.bank_rule_map;` 可执行
  - [x] T2.3 初版规则入库（产出：priority/关键词规则可运行）✅ `sql/yufeng_apply_classification.sql`（约90+条规则）
    - 验证：规则条数>0；priority 无明显冲突；抽样流水可命中（至少命中”美团/饿了么/抖音/手续费”等）
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
    - 说明：从历史未分类/易错分类中抽样 20~50 条作为固定验证集，避免”修A坏B”。
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
  - [x] T3.2 幂等导入策略（产出：导入”重跑不重复”的策略落地）✅ `scripts/idempotent_import.md`
    - 优先策略：按 source_file_id 维度”删当次导入数据→重灌”（最小复杂度）
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
  - [x] T3.5 “导入后一键检查”命令/脚本（产出：import→classify→coverage→unclassified→dm 的串联入口）
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

- [x] T5 dbt/SQL 模型与口径落地（产出：DM 表清单 + 字段口径 + SQL/dbt 模型）
  - 一期每品牌核心 DM（3张主表）：`<brand>_dm.revenue_monthly` / `<brand>_dm.expense_monthly` / `<brand>_dm.profit_monthly`
  - 为支持”覆盖率<100%人工匹配/UI”，Yufeng 增补（表或 view）：`yufeng_dm.bank_txn_classified`（override>rule>unclassified） + `yufeng_dm.coverage_monthly`

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
  - [x] T6.1 端到端验收脚本/命令清单（产出：README 中的”一条龙命令”）
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
      cd 项目/WDG Data Foundation
      cp .env.example .env
      set -a && source .env && set +a
      ```
  - [x] T9.2 一键初始化脚本（产出：建库/建schema/跑DDL/种子规则）
    - 验证：新机器上按 README 步骤可在 10 分钟内跑起。
    - ✅ 脚本路径：`scripts/init_local_env.sh`
    - 运行示例：
      ```bash
      # 进入项目目录
      cd /path/to/WDG Data Foundation

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
    - 自动化脚本（用于后续“按设计一键生成报表/看板”）：`scripts/metabase_seed_dashboard.py`
      - 已生成示例 Questions（Yufeng 财务看板组件）：
        - `Yufeng｜收支总揽（表）`（cardId=44）
        - `Yufeng｜支出一级分类（饼图）`（cardId=45）
        - `Yufeng｜支出二级分类（饼图）`（cardId=46）
        - `Yufeng｜收入二级分类（柱状图）`（cardId=47）

  - [x] T8.5 Pipeline 覆盖率（按上传文件/任务维度）（完成时间：2026-03-22）
    - 口径：覆盖率统计以 `raw.ingest_file.id (source_file_id)` 为维度（1 个文件=1 个 ID；支持多文件上传，但每个文件绑定不同 ID）
    - 产出：SQL 视图 `yufeng_dm.v_coverage_by_file`（按 source_file_id 汇总） + `yufeng_dm.v_unclassified_top_by_file`
    - SQL 文件：`sql/yufeng_coverage_by_file.sql`
    - UI 变更：`ui/src/app/pipeline/page.tsx`（/pipeline 默认展示“最近上传文件列表 + 每个文件覆盖率 + 未分类 TopN”；使用 brand context / brand selector）
    - 验证 SQL：
      ```sql
      -- 最近上传文件的覆盖率
      select * from yufeng_dm.v_coverage_by_file limit 10;

      -- 取任意 source_file_id，查看该文件的未分类 TopN
      select * from yufeng_dm.v_unclassified_top_by_file where source_file_id = :file_id limit 20;
      ```

### 4.2 Doing
- [ ] （待开始）

### 4.3 Done
- [x] T0 创建项目骨架（产出：项目目录+进度卡/总结/说明｜完成时间：2026-03-21 22:54）
- [x] T0.1 第一版架构/技术栈/数据库结构方案记录（产出：ProjectTasks.md 更新｜完成时间：2026-03-21 23:21）

---

## 5) P0 任务完成记录（2026-03-22）

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
