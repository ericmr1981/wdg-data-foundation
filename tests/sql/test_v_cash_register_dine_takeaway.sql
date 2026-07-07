-- v_cash_register_dine_takeaway 集成测试
-- 期望: sh_sjh 6 月至少 堂食 + 外卖 两类,各 KPI 合法,sum 与 overview 一致

DO $$
DECLARE
    cnt int;
BEGIN
    SELECT COUNT(DISTINCT order_type) INTO cnt
    FROM brand_tamkoko_dm.v_cash_register_dine_takeaway
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';
    IF cnt < 2 THEN
        RAISE EXCEPTION 'expected ≥2 distinct order_type (堂食 + 外卖), got %', cnt;
    END IF;

    -- gross 之和应等于 overview 的 gross
    PERFORM 1
    FROM (
        SELECT SUM(gross_amt) AS dt_sum
        FROM brand_tamkoko_dm.v_cash_register_dine_takeaway
        WHERE store_code = 'sh_sjh' AND month = '2026-06-01'
    ) d, (
        SELECT gross_amt AS ov_sum
        FROM brand_tamkoko_dm.v_cash_register_overview
        WHERE store_code = 'sh_sjh' AND month = '2026-06-01'
    ) o
    WHERE ABS(d.dt_sum - o.ov_sum) > 0.01;
    IF FOUND THEN
        RAISE EXCEPTION 'dine_takeaway sum ≠ overview (>0.01 diff)';
    END IF;

    RAISE NOTICE 'v_cash_register_dine_takeaway OK: % types', cnt;
END $$;
