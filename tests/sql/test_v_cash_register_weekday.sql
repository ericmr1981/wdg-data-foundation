DO $$
DECLARE
    cnt int;
    bad record;
BEGIN
    SELECT COUNT(DISTINCT weekday) INTO cnt
    FROM brand_tamkoko_dm.v_cash_register_weekday
    WHERE store_code = 'sh_sjh';
    IF cnt < 4 THEN
        RAISE EXCEPTION 'expected ≥4 distinct weekdays, got %', cnt;
    END IF;

    -- weekday 必须在 [0, 6] 区间
    FOR bad IN
        SELECT week_start, weekday FROM brand_tamkoko_dm.v_cash_register_weekday
        WHERE store_code = 'sh_sjh' AND (weekday < 0 OR weekday > 6)
    LOOP
        RAISE EXCEPTION 'invalid weekday % on %', bad.weekday, bad.week_start;
    END LOOP;

    RAISE NOTICE 'v_cash_register_weekday OK: % weekdays', cnt;
END $$;
