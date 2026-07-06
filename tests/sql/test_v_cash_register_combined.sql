DO $$
DECLARE
    cnt int;
    combined_sum numeric;
    overview_gross numeric;
BEGIN
    -- 调用函数:sh_sjh × 2026-06-01 × (order_source, order_type)
    SELECT COUNT(*) INTO cnt
    FROM brand_tamkoko_dm.fn_cash_register_combined(
        p_store_code := 'sh_sjh',
        p_month      := '2026-06-01',
        p_dim1       := 'order_source',
        p_dim2       := 'order_type'
    );
    IF cnt < 2 THEN
        RAISE EXCEPTION 'expected ≥2 combined rows for sh_sjh/2026-06, got %', cnt;
    END IF;

    -- 白名单校验:非法 dim 应抛错
    BEGIN
        PERFORM brand_tamkoko_dm.fn_cash_register_combined(
            p_store_code := 'sh_sjh',
            p_month      := '2026-06-01',
            p_dim1       := 'evil; DROP TABLE x;--',
            p_dim2       := 'order_type'
        );
        RAISE EXCEPTION 'whitelist bypassed — security bug';
    EXCEPTION WHEN OTHERS THEN
        -- 预期抛错
        NULL;
    END;

    -- dim1=weekday, dim2=order_type 也应工作
    cnt := 0;
    SELECT COUNT(*) INTO cnt
    FROM brand_tamkoko_dm.fn_cash_register_combined(
        p_store_code := 'sh_sjh',
        p_month      := '2026-06-01',
        p_dim1       := 'weekday',
        p_dim2       := 'order_type'
    );
    IF cnt < 2 THEN
        RAISE EXCEPTION 'weekday+order_type combo returned % rows, expected ≥2', cnt;
    END IF;

    -- 组合的 gross 之和应等于 overview gross(±0.01)
    SELECT SUM(gross_amt) INTO combined_sum
    FROM brand_tamkoko_dm.fn_cash_register_combined(
        p_store_code := 'sh_sjh',
        p_month      := '2026-06-01',
        p_dim1       := 'order_source',
        p_dim2       := 'order_type'
    );
    SELECT gross_amt INTO overview_gross
    FROM brand_tamkoko_dm.v_cash_register_overview
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';
    IF overview_gross IS NULL THEN
        RAISE EXCEPTION 'overview has no sh_sjh/2026-06-01 row';
    END IF;
    IF ABS(combined_sum - overview_gross) > 0.01 THEN
        RAISE EXCEPTION 'combined gross % ≠ overview gross %', combined_sum, overview_gross;
    END IF;

    RAISE NOTICE 'v_cash_register_combined OK: % rows, sum % ≈ overview %', cnt, combined_sum, overview_gross;
END $$;
