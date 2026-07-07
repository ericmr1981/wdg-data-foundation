DO $$
DECLARE
    sh_gross numeric;
    total numeric;
BEGIN
    -- sh_sjh 6 月 gross 应等于 overview 同月份 gross
    SELECT gross_amt INTO sh_gross
    FROM brand_tamkoko_dm.v_cash_register_multi_store
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';
    IF sh_gross IS NULL THEN
        RAISE EXCEPTION 'no sh_sjh/2026-06 in multi_store view';
    END IF;

    PERFORM 1
    FROM brand_tamkoko_dm.v_cash_register_multi_store m,
         brand_tamkoko_dm.v_cash_register_overview o
    WHERE m.store_code = 'sh_sjh' AND m.month = '2026-06-01'
      AND o.store_code = 'sh_sjh' AND o.month = '2026-06-01'
      AND ABS(m.gross_amt - o.gross_amt) > 0.01;
    IF FOUND THEN
        RAISE EXCEPTION 'multi_store gross ≠ overview gross';
    END IF;

    RAISE NOTICE 'v_cash_register_multi_store OK';
END $$;
