# OPS Schema 说明

## 概述

`ops` schema 用于记录 T+1 批处理的运行元数据，支持跨品牌（Bonjur / Yufeng）共用。

## 表清单

| 表名 | 用途 |
|------|------|
| `ops.pipeline_run` | 一次完整的批处理运行 |
| `ops.pipeline_step_run` | 每个步骤的执行明细 |
| `ops.data_quality_check` | 数据质量检查结果 |
| `ops.classification_metrics` | 分类覆盖率（Yufeng 重点）|

---

## 1. pipeline_run（一次运行）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `run_id` | uuid | 主键，一次运行唯一 |
| `brand_code` | text | 品牌编码（bonjur / yufeng） |
| `store_code` | text | 门店编码（可选，空表示全量） |
| `started_at` | timestamptz | 开始时间 |
| `finished_at` | timestamptz | 结束时间（运行完成后填） |
| `status` | text | 运行状态：running / success / failed |
| `triggered_by` | text | 触发方式：cron / manual |
| `month` | text | 运行的月份（YYYY-MM） |
| `note` | text | 备注 |

### ETL 写入时机

- **开始时**：INSERT（status='running'）
- **结束时**：UPDATE（status='success' 或 'failed'，填 finished_at）

---

## 2. pipeline_step_run（步骤执行）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `step_id` | bigserial | 主键 |
| `run_id` | uuid | 关联 pipeline_run |
| `step_name` | text | 步骤名称（见下方枚举） |
| `step_order` | int | 执行顺序 |
| `status` | text | 状态：running / success / failed / skipped |
| `started_at` | timestamptz | 步骤开始时间 |
| `finished_at` | timestamptz | 步骤结束时间 |
| `rows_in` | int | 输入行数 |
| `rows_out` | int | 输出行数 |
| `rows_rejected` | int | 拒绝/失败行数 |
| `duration_sec` | int | 耗时（秒） |
| `error_message` | text | 失败时的错误信息 |
| `detail` | jsonb | 额外信息（如文件路径、解析错误明细） |

### step_name 枚举（建议执行顺序）

| step_name | 说明 | 写入时机 |
|-----------|------|----------|
| `raw_archive` | 文件到达/归档 | 文件复制到 raw 目录后 |
| `schema_validate` | 格式/表头识别与字段校验 | 解析 CSV/Excel 表头后 |
| `ods_load` | ODS 导入（sales_daily / bank_txn） | 数据写入 ods.* 后 |
| `classify` | 分类（rule + override） | 分类计算完成后（Yufeng） |
| `dm_build` | DM 聚合生成 | dm.* 报表生成后 |
| `dq_check` | 数据质量检查 | DQ 检查执行后 |
| `bi_check` | 服务层检查（Metabase 卡片可用性） | 可选，最后检查 |

### ETL 写入时机

- **步骤开始**：INSERT（status='running'）
- **步骤成功**：UPDATE（status='success'，填 rows_out、duration_sec）
- **步骤失败**：UPDATE（status='failed'，填 error_message）
- **跳过**：UPDATE（status='skipped'）

---

## 3. data_quality_check（数据质量）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `check_id` | bigserial | 主键 |
| `run_id` | uuid | 关联 pipeline_run |
| `brand_code` | text | 品牌编码 |
| `store_code` | text | 门店编码 |
| `month` | text | 月份 |
| `check_name` | text | 检查项名称 |
| `check_type` | text | 检查类型：null_check / range_check / uniqueness / consistency / threshold |
| `check_level` | text | 级别：warn / fail |
| `severity` | text | 严重程度：low / medium / high / critical |
| `metric_value` | numeric | 实际值 |
| `threshold` | numeric | 阈值 |
| `passed` | boolean | 是否通过 |
| `subject_table` | text | 检查的表 |
| `subject_field` | text | 检查的字段 |
| `subject_value` | text | 违规值示例 |
| `detail` | jsonb | 详细结果 |

### 常用检查项示例

| check_name | 说明 |
|------------|------|
| `null_check.store_code` | store_code 不能为空 |
| `null_check.txn_time` | txn_time 不能为空 |
| `range_check.revenue_amt` | revenue_amt 必须在合理范围 |
| `range_check.amt_non_negative` | 金额不能为负 |
| `uniqueness.bank_txn` | 银行流水去重检查 |
| `consistency.revenue_vs_bank` | 业务收入 vs 银行实收差异 |
| `threshold.coverage_rate` | 分类覆盖率阈值 |

### ETL 写入时机

- 在 `dq_check` 步骤中批量 INSERT，每条检查结果一行

---

## 4. classification_metrics（分类覆盖率）

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | bigserial | 主键 |
| `run_id` | uuid | 关联 pipeline_run |
| `brand_code` | text | 品牌编码 |
| `store_code` | text | 门店编码 |
| `month` | text | 月份（YYYY-MM） |
| `source_table` | text | 源表（ods.bank_txn） |
| `total_rows` | int | 总行数 |
| `covered_rows` | int | 有分类的行数 |
| `unclassified_rows` | int | 无分类的行数 |
| `total_amt` | numeric | 总金额 |
| `covered_amt` | numeric | 有分类的金额 |
| `unclassified_amt` | numeric | 无分类的金额 |
| `coverage_rate` | numeric | 行数覆盖率（%）自动计算 |
| `coverage_amt_rate` | numeric | 金额覆盖率（%）自动计算 |
| `top_unclassified_counterparties` | jsonb | 未分类 Top 对方单位 |
| `top_unclassified_keywords` | jsonb | 未分类 Top 关键词 |
| `source_override_rows` | int | 人工 override 行数 |
| `source_rule_rows` | int | 规则命中行数 |
| `source_unclassified` | int | 未分类行数 |
| `detail` | jsonb | 额外信息 |
| `computed_at` | timestamptz | 计算时间 |

### top_unclassified 结构示例

```json
[
  {"counterparty": "xxx公司", "rows": 5, "amt": 10000},
  {"counterparty": "yyy商户", "rows": 3, "amt": 5000}
]
```

### ETL 写入时机

- 在 `classify` 步骤完成后 INSERT 或 UPDATE
- 按 brand_code + store_code + month 去重

---

## 使用示例

### 查看最近一次运行的步骤状态

```sql
select pr.brand_code, pr.month, pr.status as run_status,
       ps.step_name, ps.status as step_status, ps.duration_sec
from ops.pipeline_run pr
join ops.pipeline_step_run ps on pr.run_id = ps.run_id
where pr.brand_code = 'yufeng'
order by pr.started_at desc, ps.step_order
limit 20;
```

### 查看本月 DQ 告警

```sql
select check_name, check_level, severity, passed, subject_table, subject_value
from ops.data_quality_check
where brand_code = 'yufeng' and month = '2026-02' and not passed
order by severity desc;
```

### 查看分类覆盖率趋势

```sql
select month, coverage_rate, coverage_amt_rate,
       covered_rows, total_rows, unclassified_rows
from ops.classification_metrics
where brand_code = 'yufeng' and store_code = 'yf_gh'
order by month desc;
```
