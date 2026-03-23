# WDG Data Foundation｜Pipeline 控制点（Gates）与监控 Dashboard（一期 v0）

目标：在整条数据链路预埋可观测“控制点”，用 **一张 Dashboard** 监控各点状态，为后续增加 AI agent 自动巡检/补规则/自愈做底座。

> 一期原则：轻量、可落地、以 PostgreSQL + Metabase 为主；不引入 Prometheus/Grafana 也能跑。

---

## 1. 控制点总览（从文件到 DM）
建议把每次 T+1 跑批定义为一个 `run_id`，拆成以下步骤（step）：

1) **文件到达/归档（RAW）**
- Gate：文件是否落到 inputs/raw 归档目录；hash 是否记录；是否重复导入

2) **格式/表头识别与字段校验（Schema Validate）**
- Gate：CSV 列是否齐全；Excel 表头行是否识别成功；关键字段（时间/金额）可解析

3) **ODS 导入**
- Gate：入库行数、空值比例、时间范围是否异常；是否有 store_code 映射失败

4) **分类（rule + override）**（Yufeng 重点）
- Gate：覆盖率（笔数/金额）；未分类 Top 对方单位/关键词；规则命中分布

5) **DM 聚合生成**
- Gate：当月 revenue/expense/profit 是否产出；与上期对比波动是否异常

6) **对账/一致性检查（DQ Checks）**
- Gate：revenue_amt ≈ gross-discount（Bonjur）；银行收入口径波动；负数/极端值

7) **服务层（Metabase 可见）**
- Gate：关键卡片是否能查询；刷新时间；是否有报错

---

## 2. 建议的“运行元数据表”（ops schema）
> 目的：所有控制点都落在 DB 里，Metabase 直接做监控 Dashboard；AI agent 也只需要读这些表就能判断健康状况。

建议新建通用 schema：`ops`（跨品牌共用；字段带 brand_code/store_code）：

### 2.1 `ops.pipeline_run`
- run_id (uuid)
- started_at / finished_at
- status (running/success/failed)
- triggered_by (cron/manual)
- note

### 2.2 `ops.pipeline_step_run`
- run_id
- step_name (raw_archive/validate/ods_load/classify/dm_build/dq_check/bi_check)
- status
- started_at / finished_at
- rows_in / rows_out
- error_message (nullable)

### 2.3 `ops.data_quality_check`
- run_id
- brand_code / store_code
- check_name
- check_level (warn/fail)
- metric_value
- threshold
- passed boolean
- detail (json/text)

### 2.4 `ops.classification_metrics`（可选，Yufeng 先做）
- run_id
- month
- brand_code/store_code
- covered_rows / total_rows
- covered_amt / total_amt
- unclassified_rows / unclassified_amt
- top_unclassified_counterparties (json)

> 备注：一期可以先用 view 生成，后面再落物理表。

---

## 3. 监控 Dashboard（Metabase 一张看全）
Dashboard 名：**Pipeline Health / 数据链路健康度**

建议卡片（最少 8 张）：
1. 最近一次 run 总状态（成功/失败/耗时）
2. 每个 step 的状态与耗时（step_run）
3. ODS 入库行数趋势（按 brand/store/月）
4. 解析失败/映射失败计数（例如 store_code unmapped）
5. Yufeng 分类覆盖率：笔数/金额（按月）
6. 未分类 Top 对方单位/关键词（当月）
7. DM 产出校验：revenue/expense/profit 是否为 NULL、是否缺月
8. DQ Checks 告警列表（warn/fail）

---

## 4. 为 AI agent 自动维护预留接口
AI agent 的输入（只读）：
- ops.*（运行状态、失败原因、覆盖率、未分类Top）
- yufeng_dm.bank_txn_classified（未分类明细）

AI agent 的输出（建议“建议→人工确认→落库”）：
- 生成候选规则（bank_rule_map）草案 + 预估覆盖率提升
- 生成“需要人工确认的 Top N 未分类交易”任务列表

> 关键原则：一期不自动改口径；AI 先做“建议/草案”，由 UI 人工确认后生效。

---

## 5. 一期落地顺序（建议）
1) 先建 ops.pipeline_run / ops.pipeline_step_run（最小可观测）
2) 再把 Yufeng 覆盖率与未分类Top接进去（分类是当前最大风险点）
3) 再补 DQ checks（Bonjur 收入口径校验、波动阈值）
4) 最后做 Metabase Dashboard 汇总
