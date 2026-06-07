-- ============================================================
-- ops.notification + ops.notification_read + ops.report_file
-- + ops.notification_schedule + ops.notification_schedule_run
-- 提醒消息 + 报表文件 + 调度配置 DDL
-- 创建时间: 2026-06-07
-- 幂等: IF NOT EXISTS
-- 注: ops.users.user_id 是 UUID,本文件所有引用 users 的 FK 都用 UUID
-- ============================================================

-- 1. ops.notification (主表)
CREATE TABLE IF NOT EXISTS ops.notification (
    id              BIGSERIAL PRIMARY KEY,
    type            VARCHAR(40) NOT NULL,
    brand_code      VARCHAR(50),
    severity        VARCHAR(10) NOT NULL DEFAULT 'info',
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    action_url      TEXT,
    action_label    VARCHAR(80),
    related_id      BIGINT,
    dedup_key       VARCHAR(120) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    swept_at        TIMESTAMPTZ,
    CONSTRAINT chk_notification_type CHECK (type IN ('data_stale','unmatched_txn','dup_rule','monthly_report')),
    CONSTRAINT chk_notification_severity CHECK (severity IN ('info','warn','error')),
    CONSTRAINT chk_notification_status CHECK (status IN ('active','dismissed','resolved'))
);

-- 同 dedup_key 同时只能有 1 条 active (部分唯一索引)
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_active_dedup
    ON ops.notification (dedup_key) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_notification_brand_status
    ON ops.notification (brand_code, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_type_created
    ON ops.notification (type, created_at DESC);

-- 2. ops.notification_read (已读, 每用户一行)
CREATE TABLE IF NOT EXISTS ops.notification_read (
    notification_id BIGINT NOT NULL REFERENCES ops.notification(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES ops.users(user_id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_read_user
    ON ops.notification_read (user_id, read_at DESC);

-- 3. ops.report_file (报表文件元数据)
CREATE TABLE IF NOT EXISTS ops.report_file (
    id              SERIAL PRIMARY KEY,
    brand_code      VARCHAR(50) NOT NULL,
    period          DATE NOT NULL,
    report_type     VARCHAR(40) NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    file_path       TEXT NOT NULL,
    file_hash       VARCHAR(64) NOT NULL,
    file_size       BIGINT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (brand_code, period, report_type)
);

CREATE INDEX IF NOT EXISTS idx_report_file_brand_period
    ON ops.report_file (brand_code, period DESC);

-- 4. ops.notification_schedule (调度配置)
CREATE TABLE IF NOT EXISTS ops.notification_schedule (
    id              SERIAL PRIMARY KEY,
    task_name       VARCHAR(40) UNIQUE NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    cron_expr       VARCHAR(80) NOT NULL,
    brands_filter   TEXT,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES ops.users(user_id)
);

-- 5. ops.notification_schedule_run (执行日志)
CREATE TABLE IF NOT EXISTS ops.notification_schedule_run (
    id                  BIGSERIAL PRIMARY KEY,
    schedule_id         INT REFERENCES ops.notification_schedule(id) ON DELETE SET NULL,
    task_name           VARCHAR(40) NOT NULL,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    status              VARCHAR(20),
    error_message       TEXT,
    new_notifications   INT,
    trigger_source      VARCHAR(20),
    CONSTRAINT chk_schedule_run_status CHECK (status IN ('running','success','failed','skipped')),
    CONSTRAINT chk_schedule_run_trigger_source CHECK (trigger_source IN ('cron','manual','reload'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_run_task_started
    ON ops.notification_schedule_run (task_name, started_at DESC);

-- 注释
COMMENT ON TABLE ops.notification IS '站内提醒主表,4 种 type: data_stale/unmatched_txn/dup_rule/monthly_report';
COMMENT ON TABLE ops.notification_read IS '每用户已读位';
COMMENT ON TABLE ops.report_file IS '月报表 xlsx 文件元数据';
COMMENT ON TABLE ops.notification_schedule IS '调度配置 (cron + 品牌过滤),可运行时改';
COMMENT ON TABLE ops.notification_schedule_run IS '调度执行历史,与 ops.pipeline_step_run 思路一致';
