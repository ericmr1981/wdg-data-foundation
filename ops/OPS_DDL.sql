-- OPS Schema DDL（一期：Pipeline 运行元数据表）
-- 用途：记录 T+1 批处理的运行状态、步骤执行、数据质量检查、分类覆盖率
-- 适用：跨品牌共用（Bonjur / Yufeng）

create schema if not exists ops;

-- Needed for gen_random_uuid() and crypt()
create extension if not exists pgcrypto;

-- ============================================================
-- 0. Auth (B1): users + sessions
-- Note: Brands/Stores registry lives in ops/BRANDS_DDL.sql
-- ============================================================
create table if not exists ops.users (
    user_id       uuid primary key default gen_random_uuid(),
    username      text not null unique,
    password_hash text not null,
    role          text not null check (role in ('admin','operator')),
    enabled       boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table if not exists ops.sessions (
    session_id    uuid primary key default gen_random_uuid(),
    token         text not null unique,
    user_id       uuid not null references ops.users(user_id),
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    last_seen_at  timestamptz
);

create index if not exists idx_sessions_token on ops.sessions(token);
create index if not exists idx_sessions_user on ops.sessions(user_id);

-- ============================================================
-- 1. Pipeline Run：一次完整的 T+1 批处理运行
-- ============================================================
create table if not exists ops.pipeline_run (
    run_id          uuid primary key default gen_random_uuid(),
    brand_code      text not null,           -- bonjur | yufeng
    store_code      text,                    -- nullable，按门店可选跑

    started_at      timestamptz not null default now(),
    finished_at     timestamptz,

    status          text not null default 'running',  -- running | success | failed
    triggered_by    text not null default 'cron',     -- cron | manual

    month           text,                    -- 运行的月份（YYYY-MM）
    note            text,

    created_at      timestamptz not null default now()
);

create index if not exists idx_pipeline_run_brand_month on ops.pipeline_run(brand_code, month desc);
create index if not exists idx_pipeline_run_status on ops.pipeline_run(status);
create index if not exists idx_pipeline_run_started on ops.pipeline_run(started_at desc);

-- ============================================================
-- 2. Pipeline Step Run：每个步骤的执行明细
-- ============================================================
create table if not exists ops.pipeline_step_run (
    step_id         bigserial primary key,
    run_id          uuid not null references ops.pipeline_run(run_id),

    step_name       text not null,           -- 见下方 step_name 枚举
    step_order      int not null,            -- 执行顺序

    status          text not null default 'running',  -- running | success | failed | skipped
    started_at      timestamptz not null default now(),
    finished_at     timestamptz,

    rows_in         int,                      -- 输入行数
    rows_out        int,                      -- 输出行数
    rows_rejected   int default 0,            -- 拒绝/失败行数

    duration_sec    int,                      -- 耗时（秒）

    error_message   text,                      -- 失败时的错误信息
    detail          jsonb,                     -- 额外信息（如文件路径、解析错误明细等）

    created_at      timestamptz not null default now()
);

create index if not exists idx_step_run_run_id on ops.pipeline_step_run(run_id);
create index if not exists idx_step_run_step_name on ops.pipeline_step_run(step_name);

-- step_name 枚举建议（按执行顺序）：
-- 1. raw_archive      - 文件到达/归档
-- 2. schema_validate  - 格式/表头识别与字段校验
-- 3. ods_load         - ODS 导入（sales_daily / bank_txn）
-- 4. classify         - 分类（rule + override）
-- 5. dm_build         - DM 聚合生成
-- 6. dq_check         - 数据质量检查
-- 7. bi_check         - 服务层检查（Metabase 卡片可用性）

-- ============================================================
-- 3. Data Quality Check：数据质量检查结果
-- ============================================================
create table if not exists ops.data_quality_check (
    check_id        bigserial primary key,
    run_id          uuid references ops.pipeline_run(run_id),

    brand_code      text not null,
    store_code      text,
    month           text,

    check_name      text not null,           -- 检查项名称
    check_type      text not null,           -- null_check | range_check | uniqueness | consistency | threshold

    check_level     text not null default 'warn',  -- warn | fail
    severity       text not null default 'medium', -- low | medium | high | critical

    metric_value    numeric,                  -- 实际值
    threshold       numeric,                  -- 阈值
    passed          boolean not null,          -- 是否通过

    subject_table   text,                     -- 检查的表
    subject_field   text,                     -- 检查的字段
    subject_value   text,                     -- 违规值示例

    detail          jsonb,                    -- 详细结果

    checked_at      timestamptz not null default now()
);

create index if not exists idx_dq_check_run_id on ops.data_quality_check(run_id);
create index if not exists idx_dq_check_brand_month on ops.data_quality_check(brand_code, month desc);
create index if not exists idx_dq_check_passed on ops.data_quality_check(passed);

-- 常用检查项（check_name）建议：
-- null_check.store_code         - store_code 不能为空
-- null_check.txn_time           - txn_time 不能为空
-- range_check.revenue_amt       - revenue_amt 必须在合理范围
-- range_check.in_amt.out_amt    - 金额不能为负
-- uniqueness.bank_txn           - 银行流水去重检查
-- consistency.revenue_vs_bank   - 业务收入 vs 银行实收差异
-- threshold.coverage_rate        - 分类覆盖率阈值

-- ============================================================
-- 4. Classification Metrics：分类覆盖率（Yufeng 重点）
-- ============================================================
create table if not exists ops.classification_metrics (
    id              bigserial primary key,
    run_id          uuid references ops.pipeline_run(run_id),

    brand_code      text not null,
    store_code      text,
    month           text not null,            -- YYYY-MM

    source_table    text not null,           -- ods.bank_txn
    total_rows      int not null,
    covered_rows    int not null,             -- 有分类的行数
    unclassified_rows int not null,          -- 无分类的行数

    total_amt       numeric not null,
    covered_amt     numeric not null,         -- 有分类的金额
    unclassified_amt numeric not null,         -- 无分类的金额

    -- 覆盖率
    coverage_rate   numeric generated always as (
        case when total_rows > 0 then round(covered_rows::numeric / total_rows * 100, 2)
        else 0 end
    ) stored,
    coverage_amt_rate numeric generated always as (
        case when total_amt > 0 then round(covered_amt::numeric / total_amt * 100, 2)
        else 0 end
    ) stored,

    -- 未分类 Top（JSON 数组）
    top_unclassified_counterparties jsonb,    -- [{"counterparty": "xxx", "rows": 5, "amt": 1000}, ...]
    top_unclassified_keywords       jsonb,    -- [{"keyword": "xxx", "rows": 3, "amt": 500}, ...]

    -- 分类来源分布
    source_override_rows   int default 0,     -- 人工 override
    source_rule_rows       int default 0,     -- 规则命中
    source_unclassified    int default 0,     -- 未分类

    detail          jsonb,

    computed_at     timestamptz not null default now(),

    unique(brand_code, store_code, month)
);

create index if not exists idx_classification_metrics_brand_month on ops.classification_metrics(brand_code, month desc);
create index if not exists idx_classification_metrics_coverage_rate on ops.classification_metrics(coverage_rate);

-- ============================================================
-- 注释：ETL 写入时机
-- ============================================================
-- 1. pipeline_run：
--    - ETL 开始时 INSERT（status='running'）
--    - ETL 结束时 UPDATE（status='success'/'failed', finished_at=NOW()）
--
-- 2. pipeline_step_run：
--    - 每个 step 开始时 INSERT（status='running'）
--    - step 成功时 UPDATE（status='success', rows_out, duration_sec）
--    - step 失败时 UPDATE（status='failed', error_message）
--    - 可选：跳过时 UPDATE（status='skipped'）
--
-- 3. data_quality_check：
--    - 在 dq_check 步骤中批量 INSERT
--    - 每条检查结果一行
--
-- 4. classification_metrics：
--    - 在 classify 步骤完成后 INSERT/UPDATE
--    - 按 brand_code+store_code+month 去重
