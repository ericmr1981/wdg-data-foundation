-- Fix: v_bank_txn_classified_v2 performance issue
-- Problem: fn_classify_bank_txn_v2() called 7 times per row
-- Solution: Use LATERAL join to call function once per row

DROP VIEW IF EXISTS brand_gelatomiiix_dm.v_bank_txn_classified CASCADE;
DROP VIEW IF EXISTS brand_gelatomiiix_dm.v_bank_txn_classified_v2 CASCADE;

-- Create v2 view with LATERAL join (call function only once)
CREATE VIEW brand_gelatomiiix_dm.v_bank_txn_classified_v2 AS
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
    c.matched_rule_id,
    c.lvl1_code,
    c.lvl2_code,
    c.classified_source,
    COALESCE(l1.lvl1_name, '（未分类）'::text) AS lvl1_name,
    COALESCE(l2.lvl2_name, NULL::text) AS lvl2_name,
    t.source_file_id
FROM brand_gelatomiiix_ods.bank_txn t
CROSS JOIN LATERAL (
    SELECT 
        (brand_gelatomiiix_dm.fn_classify_bank_txn_v2(t.id)).*
) c
LEFT JOIN brand_gelatomiiix_cfg.dim_category_lvl1 l1 
    ON l1.lvl1_code = c.lvl1_code
LEFT JOIN brand_gelatomiiix_cfg.dim_category_lvl2 l2 
    ON l2.lvl1_code = c.lvl1_code AND l2.lvl2_code = c.lvl2_code;

-- Create v1 view (backward compatibility)
CREATE VIEW brand_gelatomiiix_dm.v_bank_txn_classified AS
SELECT * FROM brand_gelatomiiix_dm.v_bank_txn_classified_v2;
