DO $$
DECLARE
    cnt int;
    mp text;
BEGIN
    SELECT COUNT(DISTINCT meal_period) INTO cnt
    FROM brand_tamkoko_dm.v_cash_register_meal_period_overview
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';
    IF cnt < 2 THEN
        RAISE EXCEPTION 'expected ≥2 meal_period values, got %', cnt;
    END IF;

    -- 至少应有 1 个常见餐段(早/午/晚市)
    SELECT meal_period INTO mp
    FROM brand_tamkoko_dm.v_cash_register_meal_period_overview
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01'
      AND meal_period IN ('早市', '午市', '晚市')
    LIMIT 1;
    IF mp IS NULL THEN
        RAISE EXCEPTION 'no 早市/午市/晚市 found in 6 月';
    END IF;

    RAISE NOTICE 'v_cash_register_meal_period_overview OK: % periods', cnt;
END $$;
