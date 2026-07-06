DO $$
DECLARE
    cnt bigint;
BEGIN
    SELECT COUNT(*) INTO cnt
    FROM brand_tamkoko_dm.v_cash_register_meal_period_detail
    WHERE store_code = 'sh_sjh' AND biz_date BETWEEN '2026-06-01' AND '2026-06-30';
    IF cnt < 30 THEN
        RAISE EXCEPTION 'expected ≥30 day×period rows for sh_sjh 6 月, got %', cnt;
    END IF;
    RAISE NOTICE 'v_cash_register_meal_period_detail OK: % rows', cnt;
END $$;
