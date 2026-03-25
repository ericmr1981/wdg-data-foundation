-- Bonjur｜分类规则应用 v2（对齐 Yufeng v2 策略）
-- 执行日期：2026-03-25
-- 变更：
--   1. 移除 override 参与分类（override 仅日志/审计）
--   2. 按字段策略匹配：summary→memo→purpose (contains)；三者空才 counterparty (contains/exact)
--   3. 共享 yufeng_cfg 字典（lvl1_code/lvl2_code）

------------------------------------------------------------
-- DM Schema
------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS bonjur_dm;

------------------------------------------------------------
-- 人工匹配覆盖表（仅日志，不参与分类）
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bonjur_dm.bank_txn_override (
    id              BIGSERIAL PRIMARY KEY,
    bank_txn_id     BIGINT NOT NULL UNIQUE,  -- FK -> bonjur_ods.bank_txn.id

    lvl1_code       TEXT NOT NULL,
    lvl2_code       TEXT,
    note            TEXT,

    created_by      TEXT NOT NULL DEFAULT 'ui',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonjur_override_bank_txn_id ON bonjur_dm.bank_txn_override(bank_txn_id);
CREATE INDEX IF NOT EXISTS idx_bonjur_override_lvl1_code ON bonjur_dm.bank_txn_override(lvl1_code);

------------------------------------------------------------
-- 审计日志表（记录人工匹配操作）
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bonjur_dm.unclassified_resolution_log (
    id                  BIGSERIAL PRIMARY KEY,
    bank_txn_id         BIGINT NOT NULL,
    selected_lvl1_code  TEXT NOT NULL,
    selected_lvl2_code  TEXT,
    generated_rule_id   BIGINT,
    resolved_by         TEXT NOT NULL DEFAULT 'ui',
    resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonjur_resolve_log_bank_txn_id ON bonjur_dm.unclassified_resolution_log(bank_txn_id);

------------------------------------------------------------
-- 规则沉淀函数（UI 调用）
-- 将人工匹配结果写入 bank_rule_map（对未来文件立即生效）
------------------------------------------------------------
CREATE OR REPLACE FUNCTION bonjur_cfg.settle_rule(
    p_match_field TEXT,
    p_match_value TEXT,
    p_match_type TEXT DEFAULT 'contains',
    p_direction TEXT,
    p_lvl1_code TEXT,
    p_lvl2_code TEXT,
    p_priority INT DEFAULT 100,
    p_enabled BOOLEAN DEFAULT true
)
RETURNS BIGINT AS $$
DECLARE
    v_rule_id BIGINT;
BEGIN
    INSERT INTO bonjur_cfg.bank_rule_map (
        match_field,
        match_value,
        match_type,
        direction,
        lvl1_code,
        lvl2_code,
        priority,
        enabled,
        created_by
    ) VALUES (
        p_match_field,
        p_match_value,
        p_match_type,
        p_direction,
        p_lvl1_code,
        p_lvl2_code,
        p_priority,
        p_enabled,
        'ui'
    )
    ON CONFLICT DO NOTHING
    RETURNING rule_id INTO v_rule_id;

    RETURN v_rule_id;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------
-- 批量沉淀函数
------------------------------------------------------------
CREATE OR REPLACE FUNCTION bonjur_cfg.settle_rules_batch(
    p_rules JSONB
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    rec JSONB;
BEGIN
    FOR rec IN SELECT * FROM jsonb_array_elements(p_rules)
    LOOP
        PERFORM bonjur_cfg.settle_rule(
            rec->>'match_field',
            rec->>'match_value',
            COALESCE(rec->>'match_type', 'contains'),
            rec->>'direction',
            rec->>'lvl1_code',
            rec->>'lvl2_code',
            COALESCE((rec->>'priority')::INT, 100),
            COALESCE((rec->>'enabled')::BOOLEAN, true)
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------
-- 验证：覆盖写回函数（写 override 审计日志，不参与分类）
------------------------------------------------------------
CREATE OR REPLACE FUNCTION bonjur_dm.upsert_bank_txn_override(
    p_bank_txn_id BIGINT,
    p_lvl1_code TEXT,
    p_lvl2_code TEXT,
    p_note TEXT,
    p_created_by TEXT DEFAULT 'ui'
)
RETURNS VOID AS $$
BEGIN
    -- 写入 override（仅作为审计日志，不参与分类）
    INSERT INTO bonjur_dm.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
    VALUES (p_bank_txn_id, p_lvl1_code, p_lvl2_code, p_note, p_created_by)
    ON CONFLICT (bank_txn_id) DO UPDATE SET
        lvl1_code = excluded.lvl1_code,
        lvl2_code = excluded.lvl2_code,
        note = excluded.note,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 覆盖删除函数
CREATE OR REPLACE FUNCTION bonjur_dm.delete_bank_txn_override(p_bank_txn_id BIGINT)
RETURNS VOID AS $$
BEGIN
    DELETE FROM bonjur_dm.bank_txn_override WHERE bank_txn_id = p_bank_txn_id;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------
-- 旧版函数/视图保留（兼容）
------------------------------------------------------------
-- 旧版 v1 视图保留（兼容旧 UI）
CREATE OR REPLACE VIEW bonjur_dm.v_bank_txn_classified AS
SELECT 
    t.id AS bank_txn_id,
    t.store_code,
    t.txn_time,
    t.counterparty_name,
    t.summary,
    t.memo,
    t.purpose,
    t.in_amt,
    t.out_amt,
    t.source_file_id,
    -- 使用 v2 函数，但显示兼容字段名
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).matched_rule_id AS matched_rule_id,
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl1_code AS lvl1_code,
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).lvl2_code AS lvl2_code,
    (bonjur_dm.fn_classify_bank_txn_v2(t.id)).classified_source AS classified_source
FROM bonjur_ods.bank_txn t;