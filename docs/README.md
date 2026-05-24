# 数据中台｜一页读懂（架构 / 数据流 / 业务口径）

> 目标：让研发/业务都能用 **1 页**理解：数据从哪来 → 怎么处理 → 怎么分类 → 怎么看报表 → 关键口径是什么。

## 0. 这套系统解决什么问题
- 把“银行流水 / 营业数据”等原始文件，变成 **可复跑、可解释、可人工兜底** 的分类结果与月度经营报表。
- 特点：
  - **规则可管理**（关键词规则）
  - **人工可兜底**（override，优先级高于规则）
  - **可观测**（ops 运行记录 + Dashboard）

---

## 1. 总体架构（一期）
**数据库：PostgreSQL 16**（同库按品牌拆 schema）

- `raw`：原始导入任务元信息（文件登记、状态等）
- `ops`：pipeline 运行元数据（run/step 记录、监控）
- `yufeng_ods`：Yufeng 原始业务数据落库（ODS）
- `yufeng_cfg`：Yufeng 规则配置（关键词规则表）
- `yufeng_dm`：Yufeng 数据集市（DM：分类结果、覆盖率、月度报表）
- `bonjur_ods`：Bonjur ODS（一期为兼容/示例）

**应用**
- Next.js UI（无登录）：人工匹配、规则管理、pipeline/覆盖率查看、文件上传
- Metabase：Dashboard（Pipeline Health 等）

---

## 2. 数据流（从文件到报表）
下面按“每次上传文件（source_file_id）”理解一次完整生命周期：

### Step A｜上传/登记（raw）
- 文件上传后会在 `raw.ingest_file` 生成一条记录：
  - `id` = **source_file_id**（1 个文件 = 1 个 id）
  - `brand_code` / `store_code` / `month` / `file_name` / `file_hash`
  - `status`（pending/running/success/failed）等

### Step B｜导入 ODS（yufeng_ods / bonjur_ods）
- Yufeng 银行流水：写入 `yufeng_ods.bank_txn`（每条流水带 `source_file_id`）
- Bonjur 营业数据：写入 `bonjur_ods.sales_monthly`（一期月粒度）

### Step C｜分类计算（yufeng_dm）
分类遵循 **优先级：人工 override > 规则 rule > 未分类**：

1) 人工兜底（override）
- 表：`yufeng_dm.bank_txn_override`
- UI 人工匹配时写入该表。

2) 规则匹配（rule）
- 表：`yufeng_cfg.bank_rule_map`
- 字段要点：`match_field/match_value`（默认用摘要 summary 关键词），`priority`，`lvl1/lvl2`，`enabled`
- 双重匹配（冲突兜底）：可选 `match_field2/match_value2`（实现“摘要 AND 对方单位”）

3) 输出统一分类结果
- 函数：`yufeng_dm.fn_classify_bank_txn(bank_txn_id)`
- 视图：`yufeng_dm.v_bank_txn_classified`

### Step D｜覆盖率 & 未分类（监控视图）
- 月度覆盖率（趋势）：`yufeng_dm.v_coverage_monthly`
- 按文件覆盖率（任务维度）：`yufeng_dm.v_coverage_by_file`
- 未分类 Top：`yufeng_dm.v_unclassified_top` / `..._by_file`
- 未分类明细：`yufeng_dm.v_unclassified_detail`

### Step E｜DM 月度报表（给业务看）
- `yufeng_dm.revenue_monthly`：月度收入
- `yufeng_dm.expense_monthly`：月度费用（按 lvl1/lvl2 聚合）
- `yufeng_dm.profit_monthly`：月度利润

---

## 3. 业务口径（业务最关心的几件事）

### 3.1 “分类覆盖率”是什么意思？
- **覆盖率（按笔数）**：本月（或本次上传文件）内，流水中有明确 `lvl1`（不等于“未分类”）的比例。
- **覆盖率（按金额）**：收入/支出金额中，被成功分类的金额占比。

> 建议使用场景：
> - 运营/财务在“本次上传”后看：`v_coverage_by_file`
> - 经营趋势看：`v_coverage_monthly`

### 3.2 “收入/费用/利润”怎么理解？
- 收入：来自银行流水的入账（in_amt）按分类口径汇总（并可对比业务口径/差异）。
- 费用：来自银行流水的出账（out_amt）按 `lvl1/lvl2` 汇总。
- 利润：收入 - 费用（并展示差异项）。

### 3.3 人工匹配会不会自动变规则？
- 默认不会。
- 需要显式“沉淀为规则”，默认关键词使用摘要（summary）。
- 若同一关键词已被分配到不同分类（仅看 enabled=true 的规则），则要求用“摘要 AND 对方单位”做双重匹配，避免误泛化。

---

## 4. 运维/监控口径（ops）
- 一次 pipeline 运行：`ops.pipeline_run`（run_id）
- 每个 step 的耗时/状态/行数：`ops.pipeline_step_run`
- Dashboard（Metabase）：Pipeline Health（运行列表、step 明细、覆盖率趋势、未分类 TopN）

---

## 5. 关键实现文件索引（想深挖时看这些）
- 分类（override + classified）：`brand-docs/Yufeng_DM_DDL_override_and_classified.sql`
- 规则匹配/分类函数实现：`sql/yufeng_apply_classification.sql`
- 覆盖率/未分类：`sql/yufeng_coverage_and_unclassified.sql`、`sql/yufeng_coverage_by_file.sql`
- DM 月报模型：`sql/yufeng_dm_models.sql`
<<<<<<< HEAD
- Metabase 配置：`docs/METABASE_SETUP.md`、`docs/metabase-store-sync.md`
=======
- Metabase 配置：`docs/METABASE_SETUP.md`
>>>>>>> origin/main
- 初始化：`scripts/init_local_env.sh`

---

## 6. 快速验收（业务/产品视角）
1) 上传一份银行流水 → UI 看到该文件的覆盖率（按文件维度）
2) 在“未分类”里人工匹配几条 → 覆盖率提升
3) 点击“沉淀为规则” → 后续同类摘要自动命中（冲突则强制双重匹配）
4) Metabase 打开 Pipeline Health Dashboard → 能看到 run 列表、step、覆盖率与未分类 TopN
