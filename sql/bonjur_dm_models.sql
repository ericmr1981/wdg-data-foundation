-- Bonjur｜DM 模型 v2（使用 lvl1_code/lvl2_code，共享 yufeng_cfg 字典）

------------------------------------------------------------
-- revenue_monthly（收入月报）
------------------------------------------------------------
DROP VIEW IF EXISTS bonjur_dm.revenue_monthly CASCADE;

CREATE VIEW bonjur_dm.revenue_monthly AS
WITH bank_revenue AS (
    SELECT 
        date_trunc('month', t.txn_time)::date AS month,
        COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN COALESCE(t.in_amt, 0) ELSE 0 END), 0) AS bank_revenue_amt
    FROM bonjur_ods.bank_txn t
    LEFT JOIN bonjur_dm.v_bank_txn_classified_v2 c ON t.id = c.bank_txn_id
    WHERE t.txn_time IS NOT NULL AND t.in_amt > 0
    GROUP BY date_trunc('month', t.txn_time)::date
),
biz_revenue AS (
    SELECT 
        month,
        COALESCE(SUM(revenue_amt), 0) AS biz_revenue_amt
    FROM bonjur_ods.sales_monthly
    WHERE month IS NOT NULL
    GROUP BY month
)
SELECT 
    COALESCE(b.month, s.month) AS month,
    COALESCE(s.biz_revenue_amt, 0) AS biz_revenue_amt,
    COALESCE(b.bank_revenue_amt, 0) AS bank_revenue_amt,
    COALESCE(b.bank_revenue_amt, 0) - COALESCE(s.biz_revenue_amt, 0) AS diff_amt
FROM bank_revenue b
FULL OUTER JOIN biz_revenue s ON b.month = s.month
ORDER BY COALESCE(b.month, s.month) DESC;

------------------------------------------------------------
-- expense_monthly（费用月报）
------------------------------------------------------------
DROP VIEW IF EXISTS bonjur_dm.expense_monthly CASCADE;

CREATE VIEW bonjur_dm.expense_monthly AS
SELECT 
    date_trunc('month', t.txn_time)::date AS month,
    COALESCE(c.lvl1_name, '（未分类）') AS lvl1_name,
    c.lvl1_code,
    COALESCE(c.lvl2_name, NULL) AS lvl2_name,
    c.lvl2_code,
    SUM(COALESCE(t.out_amt, 0)) AS total_out_amt,
    COUNT(*) AS txn_rows
FROM bonjur_ods.bank_txn t
INNER JOIN bonjur_dm.v_bank_txn_classified_v2 c ON t.id = c.bank_txn_id
WHERE t.txn_time IS NOT NULL AND t.out_amt > 0
GROUP BY date_trunc('month', t.txn_time)::date, c.lvl1_code, c.lvl1_name, c.lvl2_code, c.lvl2_name
ORDER BY month DESC, total_out_amt DESC;

------------------------------------------------------------
-- v_expense_lvl1_monthly（一级费用趋势）
------------------------------------------------------------
DROP VIEW IF EXISTS bonjur_dm.v_expense_lvl1_monthly CASCADE;

CREATE VIEW bonjur_dm.v_expense_lvl1_monthly AS
SELECT 
    month,
    lvl1_code,
    lvl1_name,
    SUM(total_out_amt) AS total_out_amt,
    SUM(txn_rows) AS txn_rows
FROM bonjur_dm.expense_monthly
GROUP BY month, lvl1_code, lvl1_name
ORDER BY month DESC, total_out_amt DESC;

------------------------------------------------------------
-- profit_monthly（利润月报）
------------------------------------------------------------
DROP VIEW IF EXISTS bonjur_dm.profit_monthly CASCADE;

CREATE VIEW bonjur_dm.profit_monthly AS
WITH revenue AS (
    SELECT month, biz_revenue_amt, bank_revenue_amt FROM bonjur_dm.revenue_monthly
),
expense AS (
    SELECT 
        month,
        SUM(total_out_amt) AS total_expense_amt,
        SUM(CASE WHEN lvl1_code = 'MATERIAL' THEN total_out_amt ELSE 0 END) AS material_purchase_amt
    FROM bonjur_dm.expense_monthly
    GROUP BY month
),
cashflow AS (
    SELECT 
        date_trunc('month', txn_time)::date AS month,
        SUM(COALESCE(in_amt, 0)) AS total_in_amt,
        SUM(COALESCE(out_amt, 0)) AS total_out_amt
    FROM bonjur_ods.bank_txn
    WHERE txn_time IS NOT NULL
    GROUP BY date_trunc('month', txn_time)::date
)
SELECT 
    COALESCE(r.month, e.month) AS month,
    COALESCE(r.bank_revenue_amt, 0) AS bank_revenue_amt,
    COALESCE(e.total_expense_amt, 0) AS total_expense_amt,
    COALESCE(r.bank_revenue_amt, 0) - COALESCE(e.total_expense_amt, 0) AS profit_amt,
    COALESCE(r.biz_revenue_amt, 0) AS biz_revenue_amt,
    COALESCE(r.bank_revenue_amt, 0) - COALESCE(r.biz_revenue_amt, 0) AS diff_amt,
    COALESCE(cf.total_in_amt, 0) - COALESCE(cf.total_out_amt, 0) AS cashflow_amt,
    COALESCE(e.material_purchase_amt, 0) AS material_purchase_amt,
    CASE WHEN COALESCE(r.bank_revenue_amt, 0) > 0 
         THEN ROUND(100.0 * (COALESCE(r.bank_revenue_amt, 0) - COALESCE(e.material_purchase_amt, 0)) / COALESCE(r.bank_revenue_amt, 0), 2)
         ELSE 0 
    END AS gross_margin_rate
FROM revenue r
FULL OUTER JOIN expense e ON r.month = e.month
LEFT JOIN cashflow cf ON COALESCE(r.month, e.month) = cf.month
ORDER BY COALESCE(r.month, e.month) DESC;

------------------------------------------------------------
-- 验证
------------------------------------------------------------
SELECT 'DM Views Created' AS status;
