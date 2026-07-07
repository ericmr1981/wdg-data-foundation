DO $$
DECLARE
    row_count int;
    gross_sum numeric;
BEGIN
    SELECT COUNT(*) INTO row_count
    FROM brand_tamkoko_dm.v_cash_register_daily
    WHERE store_code='sh_sjh' AND biz_date BETWEEN '2026-06-01' AND '2026-06-30';
    IF row_count < 28 THEN
        RAISE EXCEPTION 'expected ≥28 day rows for sh_sjh 6 月, got %', row_count;
    END IF;

    SELECT SUM(gross_amt) INTO gross_sum
    FROM brand_tamkoko_dm.v_cash_register_daily
    WHERE store_code='sh_sjh' AND biz_date BETWEEN '2026-06-01' AND '2026-06-30';
    IF ABS(gross_sum - 432778.82) > 0.01 THEN
        RAISE EXCEPTION 'daily sum ≠ monthly overview (got %)', gross_sum;
    END IF;

    RAISE NOTICE 'v_cash_register_daily OK: % day rows, sum matches overview', row_count;
END $$;
