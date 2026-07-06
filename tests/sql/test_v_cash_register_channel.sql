-- v_cash_register_channel 集成测试
-- 期望: sh_sjh 6 月至少 3 个 order_source(企迈数店POS / 美团外卖 / 淘宝闪购),各行 KPI 合法

DO $$
DECLARE
    row_count int;
    bad_row record;
BEGIN
    SELECT COUNT(DISTINCT order_source) INTO row_count
    FROM brand_tamkoko_dm.v_cash_register_channel
    WHERE store_code = 'sh_sjh' AND month = '2026-06-01';
    IF row_count < 3 THEN
        RAISE EXCEPTION 'expected ≥3 distinct order_source for sh_sjh/2026-06, got %', row_count;
    END IF;

    -- 检查每行 KPI 合法
    FOR bad_row IN
        SELECT order_source, gross_amt, revenue_amt, cash_in_rate
        FROM brand_tamkoko_dm.v_cash_register_channel
        WHERE store_code = 'sh_sjh' AND month = '2026-06-01'
          AND (gross_amt < 0 OR revenue_amt < 0 OR cash_in_rate < 0 OR cash_in_rate > 1)
    LOOP
        RAISE EXCEPTION 'invalid KPI for source %: gross=% revenue=% rate=%',
            bad_row.order_source, bad_row.gross_amt, bad_row.revenue_amt, bad_row.cash_in_rate;
    END LOOP;

    -- 所有 order_source 的 gross 之和应等于 overview 的 gross (±0.01)
    PERFORM 1
    FROM (
        SELECT SUM(gross_amt) AS channel_sum
        FROM brand_tamkoko_dm.v_cash_register_channel
        WHERE store_code = 'sh_sjh' AND month = '2026-06-01'
    ) c, (
        SELECT gross_amt AS overview_sum
        FROM brand_tamkoko_dm.v_cash_register_overview
        WHERE store_code = 'sh_sjh' AND month = '2026-06-01'
    ) o
    WHERE ABS(c.channel_sum - o.overview_sum) > 0.01;
    IF FOUND THEN
        RAISE EXCEPTION 'channel sum ≠ overview sum (>0.01 diff)';
    END IF;

    RAISE NOTICE 'v_cash_register_channel OK: % sources, all KPI valid', row_count;
END $$;
