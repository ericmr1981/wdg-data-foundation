-- ============================================================
-- 折扣率分析模型 (discount_model) 运行与产物持久化
--
-- 目标：
--   1. 复用 ops.pipeline_run / ops.pipeline_step_run
--   2. 扩展 ops.pipeline_run 字段（module / version / cancel / active / fallback）
--   3. 新增 ops.discount_model_snapshot (version, kind, store_code) → payload jsonb
--
-- 设计要点：
--   - 状态存储：ops.pipeline_run（同事务保证 is_active 唯一）
--   - 取消标志：ops.pipeline_run.cancel_requested 定时查询
--   - 错误信息：沿用 ops.pipeline_step_run.error_message（结构化文本）
--   - 模型快照：ops.discount_model_snapshot，键 (version, kind, store_code)
--
-- 部署方式：
--   docker exec -i wdg-postgres-main psql -U postgres -d dataplatform < sql/00_discount_model_ddl.sql
-- ============================================================

SET search_path TO ops, public;

-- -------------------------------------------------
-- 1. 扩展 ops.pipeline_run（幂等）
-- -------------------------------------------------
ALTER TABLE ops.pipeline_run
  ADD COLUMN IF NOT EXISTS module           text    DEFAULT 'discount_model',
  ADD COLUMN IF NOT EXISTS pipeline         text,                  -- full | prepare | train | publish
  ADD COLUMN IF NOT EXISTS version          text,                  -- YYYY-MM-DDTHH-MM-SS
  ADD COLUMN IF NOT EXISTS store_code       text    DEFAULT 'sh_xtd',
  ADD COLUMN IF NOT EXISTS data_range_start date,
  ADD COLUMN IF NOT EXISTS data_range_end   date,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_to      text,
  ADD COLUMN IF NOT EXISTS warnings         jsonb   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pid              integer;             -- 子进程 PID，用于 API cancel kill

-- 注：ops.pipeline_run.run_id 是 text（不是 uuid），FK 在 snapshot 表中也是 text

CREATE INDEX IF NOT EXISTS idx_pipeline_run_module_started
  ON ops.pipeline_run(module, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_run_module_active
  ON ops.pipeline_run(module)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pipeline_run_version
  ON ops.pipeline_run(version);

-- 加速 stale pipeline 清理查询(status + started_at)
CREATE INDEX IF NOT EXISTS idx_pipeline_run_stale_cleanup
  ON ops.pipeline_run(status, started_at)
  WHERE finished_at IS NULL;

-- -------------------------------------------------
-- 2. 折扣模型产物快照
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.discount_model_snapshot (
    version       text        NOT NULL,                  -- YYYY-MM-DDTHH-MM-SS
    kind          text        NOT NULL,                  -- coefficients | baseline | dataset_meta
    store_code    text        NOT NULL DEFAULT 'sh_xtd',
    payload       jsonb       NOT NULL,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    run_id        text        REFERENCES ops.pipeline_run(run_id) ON DELETE SET NULL,
    PRIMARY KEY (version, kind, store_code)
);

CREATE INDEX IF NOT EXISTS idx_dms_run_id
  ON ops.discount_model_snapshot(run_id);

CREATE INDEX IF NOT EXISTS idx_dms_kind_generated
  ON ops.discount_model_snapshot(kind, generated_at DESC);

-- -------------------------------------------------
-- 3. 说明
-- -------------------------------------------------
-- discount_model_snapshot.kind 取值：
--   - dataset_meta  ：数据范围 / 样本量 / 特征列表 / 模型公式
--   - coefficients  ：OLS / Poisson / 负二项 系数 + 显著性
--   - baseline      ：无折扣基线预测（每日 actual/predicted/residual/累计）
--
-- 取消机制：
--   MCP cancel-discount-model-run 工具只写 ops.pipeline_run.cancel_requested
--   脚本每 5 秒轮询该字段，检测到后置 step.status='cancelled' 并退出
--
-- 失败保留上一版：
--   发布成功：UPDATE ops.pipeline_run SET is_active=true WHERE run_id=$1
--             同时 UPDATE 上一 active 行 SET is_active=false, fallback_to=新 version
--   发布失败：is_active=false, fallback_to=上一 active version
--
-- 唯一性保证：
--   同一 module 下，is_active=true 的行最多一条
--   （由 idx_pipeline_run_module_active 唯一索引约束）