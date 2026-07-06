-- Tamkoko | 收银明细 多维组合视图
-- 接受 (store_code?, month?, dim1, dim2) 动态组合
-- dim1/dim2 必须是以下白名单之一: order_source / order_type / meal_period / weekday
-- 防 SQL 注入:用白名单 IF 校验 + CASE WHEN 表达式函数,format() 只用 %s 拼表达式
--   (因表达式来自白名单 fn_cash_register_dim_select,等价于硬编码,无注入面)


CREATE OR REPLACE FUNCTION brand_tamkoko_dm.fn_cash_register_dim_label(
    p_dim  text,
    p_row  record
) RETURNS text AS $$
BEGIN
    RETURN CASE p_dim
        WHEN 'order_source' THEN p_row.order_source
        WHEN 'order_type'   THEN p_row.order_type
        WHEN 'meal_period'  THEN COALESCE(NULLIF(p_row.meal_period, ''), '未分类')
        WHEN 'weekday'      THEN p_row.weekday::text
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


CREATE OR REPLACE FUNCTION brand_tamkoko_dm.fn_cash_register_dim_select(
    p_dim text
) RETURNS text AS $$
BEGIN
    RETURN CASE p_dim
        WHEN 'order_source' THEN 'order_source'
        WHEN 'order_type'   THEN 'order_type'
        WHEN 'meal_period'  THEN 'COALESCE(NULLIF(meal_period, ''''), ''未分类'')'
        WHEN 'weekday'      THEN 'EXTRACT(dow FROM biz_date)::int::text'
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


CREATE OR REPLACE FUNCTION brand_tamkoko_dm.fn_cash_register_combined(
    p_store_code text DEFAULT NULL,
    p_month      date DEFAULT NULL,
    p_dim1       text DEFAULT 'order_source',
    p_dim2       text DEFAULT 'order_type'
) RETURNS TABLE (
    store_code     text,
    month          date,
    dim1_value     text,
    dim2_value     text,
    gross_amt      numeric,
    revenue_amt    numeric,
    net_amt        numeric,
    order_cnt      bigint,
    cash_in_rate   numeric,
    profit_rate    numeric
) AS $$
DECLARE
    v_dim1_expr text;
    v_dim2_expr text;
    v_sql text;
BEGIN
    -- 白名单校验(两道闸门:函数自身 + CASE 兜底)
    IF p_dim1 NOT IN ('order_source','order_type','meal_period','weekday') THEN
        RAISE EXCEPTION 'invalid dim1: %', p_dim1;
    END IF;
    IF p_dim2 NOT IN ('order_source','order_type','meal_period','weekday') THEN
        RAISE EXCEPTION 'invalid dim2: %', p_dim2;
    END IF;

    v_dim1_expr := brand_tamkoko_dm.fn_cash_register_dim_select(p_dim1);
    v_dim2_expr := brand_tamkoko_dm.fn_cash_register_dim_select(p_dim2);

    IF v_dim1_expr IS NULL THEN
        RAISE EXCEPTION 'fn_cash_register_dim_select returned NULL for dim1=%', p_dim1;
    END IF;
    IF v_dim2_expr IS NULL THEN
        RAISE EXCEPTION 'fn_cash_register_dim_select returned NULL for dim2=%', p_dim2;
    END IF;

    -- %s 嵌入表达式字符串(安全:值来自白名单函数,等价于硬编码)
    -- %L 嵌入过滤值(防参数注入)
    v_sql := format(
        'SELECT store_code,
                date_trunc(''month'', biz_date)::date AS month,
                (%s) AS dim1_value,
                (%s) AS dim2_value,
                SUM(gross_amt)    AS gross_amt,
                SUM(revenue_amt)  AS revenue_amt,
                SUM(net_amt)      AS net_amt,
                COUNT(*)          AS order_cnt,
                ROUND(SUM(revenue_amt) / NULLIF(SUM(gross_amt), 0), 6) AS cash_in_rate,
                ROUND(SUM(net_amt)      / NULLIF(SUM(gross_amt), 0), 6) AS profit_rate
           FROM brand_tamkoko_ods.cash_register_order
          WHERE (%L IS NULL OR store_code = %L)
            AND (%L IS NULL OR date_trunc(''month'', biz_date)::date = %L)
          GROUP BY store_code, month, dim1_value, dim2_value
          ORDER BY store_code, month, dim1_value, dim2_value',
        v_dim1_expr, v_dim2_expr,
        p_store_code, p_store_code,
        p_month,      p_month
    );

    RETURN QUERY EXECUTE v_sql;
END;
$$ LANGUAGE plpgsql STABLE;
