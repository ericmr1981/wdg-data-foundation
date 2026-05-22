-- Yufeng｜数据清理脚本
-- 用途：修复 yufeng_ods.bank_txn 中可能存在的 NaN 值
-- 运行时机：导入新数据后，或发现 NaN 问题后执行
--
-- 说明：
-- 1. PostgreSQL numeric 类型不支持 NaN，psycopg2 会自动将 Python NaN 转为 NULL
-- 2. 此脚本为预防性脚本，清理可能因历史原因遗留的异常数据
-- 3. 执行前建议先备份：CREATE TABLE yufeng_ods.bank_txn_backup_$(date) AS SELECT * FROM yufeng_ods.bank_txn;

------------------------------------------------------------
-- 1. 检查是否存在异常金额数据（NaN 或非数值）
------------------------------------------------------------
-- 如果结果为空，说明数据正常
-- 如果有结果，需要执行清理

SELECT
    '检测到异常金额数据' as check_result,
    count(*) as异常行数,
    count CASE WHEN in_amt IS NULL THEN 1 END as in_amt_null,
    count CASE WHEN out_amt IS NULL THEN 1 END as out_amt_null,
    count CASE WHEN balance_amt IS NULL THEN 1 END as balance_amt_null
FROM yufeng_ods.bank_txn
WHERE in_amt IS NULL OR out_amt IS NULL OR balance_amt IS NULL;

------------------------------------------------------------
-- 2. 清理异常金额数据（将 NaN 转为 NULL）
-- 注意：此操作不可逆，执行前请确认已备份
------------------------------------------------------------
/*
-- 取消注释以下语句执行清理
UPDATE yufeng_ods.bank_txn
SET
    in_amt = NULLIF(in_amt, 'NaN'),
    out_amt = NULLIF(out_amt, 'NaN'),
    balance_amt = NULLIF(balance_amt, 'NaN')
WHERE
    in_amt::text = 'NaN'
    OR out_amt::text = 'NaN'
    OR balance_amt::text = 'NaN';
*/

------------------------------------------------------------
-- 3. 验证清理结果
------------------------------------------------------------
/*
SELECT * FROM yufeng_dm.v_coverage_monthly LIMIT 5;
SELECT * FROM yufeng_dm.v_unclassified_top LIMIT 5;
*/
