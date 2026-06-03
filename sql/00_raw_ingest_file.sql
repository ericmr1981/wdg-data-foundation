-- ============================================================
-- raw.ingest_file 表 DDL
-- 用途：记录源文件登记、导入状态、追溯链路
-- 创建时间：2026-03-22
-- ============================================================

-- 1. 建表 DDL（通用层，所有品牌共用）
-- 注意：实际使用时请替换 {brand_code} 为具体品牌（如 bonjur_raw, yufeng_raw）

CREATE TABLE IF NOT EXISTS raw.ingest_file (
    -- 主键
    id              SERIAL PRIMARY KEY,

    -- 文件元数据（用于路径推断）
    brand_code      VARCHAR(50) NOT NULL,
    store_code      VARCHAR(50) NOT NULL,
    source_type     VARCHAR(20) NOT NULL,  -- 'sales' | 'bank'
    month           DATE NOT NULL,         -- 月份首日，如 2025-03-01

    -- 文件信息
    file_name       VARCHAR(255) NOT NULL,
    file_path       TEXT NOT NULL,         -- 完整路径，如 inputs/yufeng/yf_gh/bank/2025-03/xxx.xlsx
    file_hash       VARCHAR(64) NOT NULL,  -- SHA-256，长度固定64位

    -- 导入状态
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | success | failed | skipped
    error_message  TEXT,                -- 失败时的错误详情

    -- 导入统计
    row_count       INTEGER,              -- 成功导入的行数
    file_size       BIGINT,               -- 文件大小（字节）

    -- 时间戳
    started_at      TIMESTAMP,            -- 开始导入时间
    finished_at     TIMESTAMP,            -- 完成时间
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. 索引

-- 2.1 唯一约束：(brand_code, file_hash) 联合唯一，同一文件可导入不同品牌
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_file_brand_hash
    ON raw.ingest_file (brand_code, file_hash);

DROP INDEX IF EXISTS idx_ingest_file_hash_uniq;

-- 2.2 查询索引：按品牌+门店+月份+类型查询
CREATE INDEX IF NOT EXISTS idx_ingest_file_lookup
    ON raw.ingest_file (brand_code, store_code, source_type, month DESC);

-- 2.3 状态索引：查询 pending/success/failed 任务
CREATE INDEX IF NOT EXISTS idx_ingest_file_status
    ON raw.ingest_file (status);

-- 2.4 时间索引：按创建时间排序
CREATE INDEX IF NOT EXISTS idx_ingest_file_created
    ON raw.ingest_file (created_at DESC);

-- 3. 注释（可选，增加可读性）
COMMENT ON TABLE raw.ingest_file IS '源文件登记与导入追溯表';
COMMENT ON COLUMN raw.ingest_file.brand_code IS '品牌代码：bonjur | yufeng';
COMMENT ON COLUMN raw.ingest_file.store_code IS '门店代码：如 wz_oh_wxc, yf_gh';
COMMENT ON COLUMN raw.ingest_file.source_type IS '数据源类型：sales=营业数据 | bank=银行流水';
COMMENT ON COLUMN raw.ingest_file.month IS '数据所属月份（月初）';
COMMENT ON COLUMN raw.ingest_file.file_hash IS 'SHA-256 哈希值，用于去重';
COMMENT ON COLUMN raw.ingest_file.status IS 'pending=待处理 | success=成功 | failed=失败 | skipped=跳过（已存在）';

-- 4. 更新时间戳触发器（可选）
-- 先删除已存在的 trigger，确保幂等
DROP TRIGGER IF EXISTS update_ingest_file_updated_at ON raw.ingest_file;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ingest_file_updated_at
    BEFORE UPDATE ON raw.ingest_file
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 常用查询示例
-- ============================================================

-- Q1: 查询所有待处理文件
-- SELECT * FROM raw.ingest_file WHERE status = 'pending' ORDER BY created_at;

-- Q2: 按月份统计导入成功率
-- SELECT
--     brand_code,
--     store_code,
--     source_type,
--     month,
--     COUNT(*) AS total,
--     COUNT(*) FILTER (WHERE status = 'success') AS success_count,
--     ROUND(COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / COUNT(*)::NUMERIC * 100, 2) AS success_rate
-- FROM raw.ingest_file
-- GROUP BY brand_code, store_code, source_type, month
-- ORDER BY month DESC;

-- Q3: 查询导入失败详情
-- SELECT brand_code, store_code, source_type, month, file_name, error_message, created_at
-- FROM raw.ingest_file
-- WHERE status = 'failed'
-- ORDER BY created_at DESC;

-- Q4: 根据 file_hash 查询是否已存在
-- SELECT id, brand_code, store_code, source_type, month, status
-- FROM raw.ingest_file
-- WHERE file_hash = 'your-sha256-here';

-- Q5: 按 source_file_id 回溯原文件（source_file_id 即本表 id）
-- SELECT id AS source_file_id, brand_code, store_code, source_type, month, file_name, file_path
-- FROM raw.ingest_file
-- WHERE id = :source_file_id;


-- ============================================================
-- 幂等导入策略 SQL 模板
-- ============================================================

-- T3.2: 幂等导入 - 按 source_file_id 删除当次导入数据

-- 银行流水删除模板
-- DELETE FROM ods.bank_txn WHERE source_file_id = :source_file_id;

-- 营业数据删除模板
-- DELETE FROM ods.sales_daily WHERE source_file_id = :source_file_id;

-- 执行流程：
-- 1. 先根据 file_hash 检查是否已存在记录
-- 2. 若存在且 status=success，先删除 ods 表中对应数据
-- 3. 重新执行导入，保持 source_file_id 不变
-- 4. 更新 ingest_file 状态为 success
