-- Xintiandi 配送/库存数据模块
-- Schema: xintiandi
-- 用途：存储新天地门店的配送明细/库存数据，支持月总览、趋势、品项分析
-- 门店：上海黄浦新天地时尚二期Nano店

CREATE SCHEMA IF NOT EXISTS xintiandi;

-- ============================================================
-- 1. 配送明细表 (delivery_detail)
-- ============================================================
CREATE TABLE IF NOT EXISTS xintiandi.delivery_detail (
    id              BIGSERIAL PRIMARY KEY,
    
    -- 配送单信息
    delivery_no     TEXT NOT NULL,           -- 配送单号
    store_code      TEXT NOT NULL,           -- 门店编码
    store_name      TEXT NOT NULL,           -- 门店名称
    
    -- 时间
    created_time    TIMESTAMPTZ,             -- 创建时间
    
    -- 品项信息
    item_name       TEXT,                    -- 品项名称
    item_code       TEXT,                    -- 品项编码
    item_category   TEXT,                    -- 品项分类
    
    -- 数量字段
    order_qty       NUMERIC(12,2) DEFAULT 0, -- 订货数量
    audit_qty       NUMERIC(12,2) DEFAULT 0, -- 审核数量
    ship_qty        NUMERIC(12,2) DEFAULT 0, -- 发货数量
    deliver_qty     NUMERIC(12,2) DEFAULT 0,  -- 送达数量
    
    -- 金额字段
    order_amt       NUMERIC(14,2) DEFAULT 0, -- 订货金额
    
    -- 导入元数据
    source_file     TEXT,                    -- 来源文件名
    import_batch    UUID,                    -- 导入批次ID
    import_time     TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(delivery_no, item_code)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_delivery_store ON xintiandi.delivery_detail(store_code);
CREATE INDEX IF NOT EXISTS idx_delivery_created ON xintiandi.delivery_detail(created_time);
CREATE INDEX IF NOT EXISTS idx_delivery_item ON xintiandi.delivery_detail(item_code);
CREATE INDEX IF NOT EXISTS idx_delivery_category ON xintiandi.delivery_detail(item_category);
CREATE INDEX IF NOT EXISTS idx_delivery_month ON xintiandi.delivery_detail(EXTRACT(YEAR FROM created_time)::TEXT, EXTRACT(MONTH FROM created_time)::TEXT);

COMMENT ON TABLE xintiandi.delivery_detail IS '新天地门店配送明细表';

-- ============================================================
-- 2. 月度汇总表 (monthly_summary) - 预聚合
-- ============================================================
CREATE TABLE IF NOT EXISTS xintiandi.monthly_summary (
    id              BIGSERIAL PRIMARY KEY,
    
    year_month      TEXT NOT NULL,           -- YYYY-MM 格式
    store_code      TEXT NOT NULL,
    store_name      TEXT NOT NULL,
    item_category   TEXT,                     -- 品项分类（可选聚合）
    
    -- 汇总数量
    total_order_qty    NUMERIC(14,2) DEFAULT 0,
    total_audit_qty    NUMERIC(14,2) DEFAULT 0,
    total_ship_qty     NUMERIC(14,2) DEFAULT 0,
    total_deliver_qty  NUMERIC(14,2) DEFAULT 0,
    
    -- 汇总金额
    total_order_amt    NUMERIC(16,2) DEFAULT 0,
    
    -- 订单数（去重）
    delivery_count     INT DEFAULT 0,
    
    -- 更新时间和批次
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    source_batch     UUID,
    
    UNIQUE(year_month, store_code, item_category)
);

CREATE INDEX IF NOT EXISTS idx_monthly_store ON xintiandi.monthly_summary(store_code);
CREATE INDEX IF NOT EXISTS idx_monthly_month ON xintiandi.monthly_summary(year_month);
CREATE INDEX IF NOT EXISTS idx_monthly_category ON xintiandi.monthly_summary(item_category);

COMMENT ON TABLE xintiandi.monthly_summary IS '新天地门店月度汇总表';

-- ============================================================
-- 3. 导入批次记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS xintiandi.import_batch (
    batch_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name       TEXT NOT NULL,
    file_size       BIGINT,
    total_rows      INT,
    success_rows    INT DEFAULT 0,
    error_rows      INT DEFAULT 0,
    status          TEXT DEFAULT 'pending',   -- pending | processing | completed | failed
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_batch_status ON xintiandi.import_batch(status);
CREATE INDEX IF NOT EXISTS idx_import_batch_created ON xintiandi.import_batch(created_at DESC);

-- ============================================================
-- 4. 刷新月度汇总的函数
-- ============================================================
CREATE OR REPLACE FUNCTION xintiandi.refresh_monthly_summary(p_year_month TEXT, p_batch_id UUID DEFAULT NULL)
RETURNS void AS $$
BEGIN
    -- 按月和门店汇总
    INSERT INTO xintiandi.monthly_summary (
        year_month, store_code, store_name, item_category,
        total_order_qty, total_audit_qty, total_ship_qty, total_deliver_qty,
        total_order_amt, delivery_count, source_batch, updated_at
    )
    SELECT 
        TO_CHAR(created_time, 'YYYY-MM') AS year_month,
        store_code,
        store_name,
        item_category,
        SUM(order_qty) AS total_order_qty,
        SUM(audit_qty) AS total_audit_qty,
        SUM(ship_qty) AS total_ship_qty,
        SUM(deliver_qty) AS total_deliver_qty,
        SUM(order_amt) AS total_order_amt,
        COUNT(DISTINCT delivery_no) AS delivery_count,
        p_batch_id,
        NOW()
    FROM xintiandi.delivery_detail
    WHERE TO_CHAR(created_time, 'YYYY-MM') = p_year_month
    GROUP BY TO_CHAR(created_time, 'YYYY-MM'), store_code, store_name, item_category
    ON CONFLICT (year_month, store_code, item_category) 
    DO UPDATE SET
        total_order_qty = EXCLUDED.total_order_qty,
        total_audit_qty = EXCLUDED.total_audit_qty,
        total_ship_qty = EXCLUDED.total_ship_qty,
        total_deliver_qty = EXCLUDED.total_deliver_qty,
        total_order_amt = EXCLUDED.total_order_amt,
        delivery_count = EXCLUDED.delivery_count,
        source_batch = EXCLUDED.source_batch,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. 添加 ops.stores 记录（新天地门店）
-- ============================================================
-- 注意：需要先确认所属品牌。暂定为 'xintiandi' 作为独立品牌
INSERT INTO ops.brands (brand_code, brand_name, schema_prefix)
VALUES ('xintiandi', '新天地', 'xintiandi')
ON CONFLICT (brand_code) DO NOTHING;

INSERT INTO ops.stores (brand_code, store_code, store_name)
VALUES ('xintiandi', 'sh_xtd_nano', '上海黄浦新天地时尚二期Nano店')
ON CONFLICT (brand_code, store_code) DO NOTHING;

-- ============================================================
-- 6. 添加 schema 白名单
-- ============================================================
INSERT INTO ops.allowed_schemas (schema_name, brand_code, description)
VALUES ('xintiandi', 'xintiandi', '新天地配送/库存数据')
ON CONFLICT (schema_name) DO NOTHING;
