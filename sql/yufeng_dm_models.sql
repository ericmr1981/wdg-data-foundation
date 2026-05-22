-- Yufeng｜T5 DM 模型（三张主表）
-- 用途：月度收入/费用/利润汇总
-- 依赖：yufeng_ods.bank_txn, yufeng_dm.v_bank_txn_classified
-- 选择：使用 VIEW 而非 TABLE，优点是无需维护、随源数据自动更新、便于快速验收

------------------------------------------------------------
-- T5.1 收入月报（revenue_monthly）
-- 输出：month, biz_revenue_amt（业务口径）, bank_revenue_amt（银行口径）, diff_amt
-- 说明：
--   - biz_revenue_amt: 暂无可用营业数据（Yufeng 未导入 sales 表），留 NULL
--   - bank_revenue_amt: 来自 v_bank_txn_classified 中 lvl1_code='REV_BIZ' 的 in_amt 汇总
--   - diff_amt: bank_revenue_amt - biz_revenue_amt（业务-银行差异）
------------------------------------------------------------
drop view if exists yufeng_dm.revenue_monthly cascade;

create view yufeng_dm.revenue_monthly as
select
    date_trunc('month', t.txn_time)::date as month,

    -- 业务口径（暂无可用数据，留 NULL）
    -- TODO: 待 Yufeng 导入营业数据后，从 bonjur_ods.sales_monthly 或 yufeng_ods.sales_* 获取
    null::numeric as biz_revenue_amt,

    -- 银行口径：仅 lvl1_code='REV_BIZ' 的 in_amt 汇总（营业收入）
    coalesce(sum(case when c.lvl1_code = 'REV_BIZ' then coalesce(t.in_amt,0) else 0 end), 0) as bank_revenue_amt,

    -- 差异：银行 - 业务（当前 = bank - NULL = NULL）
    -- 当 biz_revenue_amt 有值后，改为: bank_revenue_amt - biz_revenue_amt
    case
        when null is null then null  -- 业务口径暂无数据
        else sum(case when c.lvl1_code = 'REV_BIZ' then coalesce(t.in_amt,0) else 0 end) - null
    end as diff_amt

from yufeng_ods.bank_txn t
left join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where t.txn_time is not null
group by date_trunc('month', t.txn_time)::date
order by date_trunc('month', t.txn_time)::date desc;


------------------------------------------------------------
-- T5.2 费用月报（expense_monthly）
-- 输出：month, lvl1, lvl2, total_out_amt
-- 说明：
--   - 基于 v_bank_txn_classified 汇总 out_amt
--   - 排除 unclassified 可单独作为一类（lvl1='未分类'）
--   - 未分类金额单独显示，便于监控覆盖率
------------------------------------------------------------
drop view if exists yufeng_dm.expense_monthly cascade;

create view yufeng_dm.expense_monthly as
select
    month,
    lvl1_code,
    lvl2_code,
    sum(out_amt) as total_out_amt,
    count(*) as txn_rows

from (
    select
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.out_amt, 0) as out_amt

    from yufeng_ods.bank_txn t
    inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.txn_time is not null
      and t.out_amt > 0  -- 只统计支出
) sub
group by month, lvl1_code, lvl2_code
order by month desc, total_out_amt desc;


------------------------------------------------------------
-- T5.2.1 一级费用趋势（v_expense_lvl1_monthly）
-- 输出：month, lvl1_code, lvl1_name, total_out_amt, txn_rows
-- 用途：Metabase 折线图（X=month, Y=total_out_amt, series=lvl1_name）
-- 说明：
--   - 从 expense_monthly 汇总到 lvl1 级别
--   - 通过 dim_category_lvl1 补齐展示名称/排序
------------------------------------------------------------
drop view if exists yufeng_dm.v_expense_lvl1_monthly cascade;

create view yufeng_dm.v_expense_lvl1_monthly as
select
    e.month,
    e.lvl1_code,
    coalesce(l1.lvl1_name, e.lvl1_code) as lvl1_name,
    sum(e.total_out_amt) as total_out_amt,
    sum(e.txn_rows) as txn_rows,
    coalesce(l1.sort_order, 9999) as sort_order
from yufeng_dm.expense_monthly e
left join yufeng_cfg.dim_category_lvl1 l1
  on e.lvl1_code = l1.lvl1_code
where (l1.direction in ('out','any') or l1.direction is null)
group by e.month, e.lvl1_code, coalesce(l1.lvl1_name, e.lvl1_code), coalesce(l1.sort_order, 9999)
order by e.month desc, sort_order, total_out_amt desc;


------------------------------------------------------------
-- T5.3 利润月报（profit_monthly）
-- 输出：month, store_code, bank_revenue_amt, total_in_amt,
--      total_expense_amt(含营建), build_expense_amt, expense_ex_build_amt(不含营建),
--      profit_amt, cashflow_amt, material_purchase_amt, gross_profit_amt, gross_margin_rate,
--      biz_revenue_amt, diff_amt
-- 说明：
--   - profit_amt = 营业收入 - 支出总金额（不包括营建费用）
--   - total_in_amt / total_expense_amt：完全按银行流水金额汇总（与分类无关）
--   - gross_margin_rate = (营业收入 - 材料采购) / 营业收入
------------------------------------------------------------
drop view if exists yufeng_dm.profit_monthly cascade;

create view yufeng_dm.profit_monthly as
with agg as (
    select
        date_trunc('month', t.txn_time)::date as month,
        t.store_code,

        -- 收入（银行口径）：营业收入（REV_BIZ）
        coalesce(sum(case when c.lvl1_code = 'REV_BIZ' then coalesce(t.in_amt,0) else 0 end), 0) as bank_revenue_amt,

        -- 收入总金额：所有 in_amt>0（与分类无关）
        coalesce(sum(case when coalesce(t.in_amt,0) > 0 then coalesce(t.in_amt,0) else 0 end), 0) as total_in_amt,

        -- 支出总金额：所有 out_amt>0（与分类无关，包含 unclassified）
        coalesce(sum(case when coalesce(t.out_amt,0) > 0 then coalesce(t.out_amt,0) else 0 end), 0) as total_expense_amt,

        -- 营建费用（BUILD）
        coalesce(sum(case when c.lvl1_code = 'BUILD' and coalesce(t.out_amt,0) > 0 then coalesce(t.out_amt,0) else 0 end), 0) as build_expense_amt,

        -- 支出总金额（不含营建）
        coalesce(sum(case when (c.lvl1_code is distinct from 'BUILD') and coalesce(t.out_amt,0) > 0 then coalesce(t.out_amt,0) else 0 end), 0) as expense_ex_build_amt,

        -- 材料采购（用于毛利率）
        coalesce(sum(case when c.lvl1_code = 'MATERIAL' and coalesce(t.out_amt,0) > 0 then coalesce(t.out_amt,0) else 0 end), 0) as material_purchase_amt

    from yufeng_ods.bank_txn t
    left join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.txn_time is not null
    group by date_trunc('month', t.txn_time)::date, t.store_code
)
select
    month,
    store_code,
    bank_revenue_amt,
    total_in_amt,
    total_expense_amt,
    build_expense_amt,
    expense_ex_build_amt,

    -- 利润 = 营业收入 - 支出总金额（不含营建）
    bank_revenue_amt - expense_ex_build_amt as profit_amt,

    -- 当月现金流 = 收入总金额 - 支出总金额
    total_in_amt - total_expense_amt as cashflow_amt,

    -- 毛利率口径（不变）：(营业收入 - 材料采购) / 营业收入
    material_purchase_amt,
    (bank_revenue_amt - material_purchase_amt) as gross_profit_amt,
    (bank_revenue_amt - material_purchase_amt) / nullif(bank_revenue_amt, 0) as gross_margin_rate,

    -- 业务口径（暂无数据，留 NULL）
    null::numeric as biz_revenue_amt,

    -- 差异（暂无业务数据时为 NULL）
    null::numeric as diff_amt
from agg
order by month desc, store_code;


------------------------------------------------------------
-- 验证查询示例
------------------------------------------------------------

-- T5.1 收入月报
-- select * from yufeng_dm.revenue_monthly;

-- T5.2 费用月报（按月+分类）
-- select * from yufeng_dm.expense_monthly;

-- T5.2.1 一级费用趋势
-- select * from yufeng_dm.v_expense_lvl1_monthly;

-- T5.3 利润月报
-- select * from yufeng_dm.profit_monthly;
