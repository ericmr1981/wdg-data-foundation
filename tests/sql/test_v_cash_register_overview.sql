-- ============================================================
-- v_cash_register_overview 集成测试
-- 前置: Plan 1 已导入 fixture,sh_sjh 有 6 月数据
-- 期望: 1 行 sh_sjh × 2026-06,gross≈432778.82,revenue≈272427.09
-- ============================================================

DO $$
DECLARE
    row_count int;
    gross_sum numeric;
    revenue_sum numeric;
    cash_in numeric;
    v_profit_rate numeric;       -- renamed to avoid ambiguity with view column profit_rate
    v_order_count bigint;         -- renamed to avoid ambiguity
BEGIN
    -- 检查有 sh_sjh × 2026-06 的数据
    SELECT COUNT(*) INTO row_count
    FROM brand_tamkoko_dm.v_cash_register_overview
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';
    IF row_count <> 1 THEN
        RAISE EXCEPTION 'expected 1 row for sh_sjh/2026-06, got %', row_count;
    END IF;

    -- 取数
    SELECT gross_amt, revenue_amt, cash_in_rate, profit_rate, order_cnt
      INTO gross_sum, revenue_sum, cash_in, v_profit_rate, v_order_count
    FROM brand_tamkoko_dm.v_cash_register_overview
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';

    -- gross 应等于 fixture 末行汇总 ±0.01
    IF ABS(gross_sum - 432778.82) > 0.01 THEN
        RAISE EXCEPTION 'gross mismatch: expected 432778.82, got %', gross_sum;
    END IF;

    -- revenue 应等于 fixture 末行汇总 ±0.01
    IF ABS(revenue_sum - 272427.09) > 0.01 THEN
        RAISE EXCEPTION 'revenue mismatch: expected 272427.09, got %', revenue_sum;
    END IF;

    -- cash_in_rate = revenue / gross ≈ 0.6294
    IF ABS(cash_in - 272427.09 / 432778.82) > 0.0001 THEN
        RAISE EXCEPTION 'cash_in_rate wrong: expected ~%, got %',
            272427.09 / 432778.82, cash_in;
    END IF;

    -- profit_rate 必须在 [0, 1] 区间
    IF v_profit_rate < 0 OR v_profit_rate > 1 THEN
        RAISE EXCEPTION 'profit_rate out of range: %', v_profit_rate;
    END IF;

    -- order_cnt > 0
    IF v_order_count <= 0 THEN
        RAISE EXCEPTION 'order_cnt must be > 0, got %', v_order_count;
    END IF;

    RAISE NOTICE 'v_cash_register_overview OK: gross=% revenue=% cash_in=% profit_rate=% order_cnt=%',
        gross_sum, revenue_sum, cash_in, v_profit_rate, v_order_count;
END $$;