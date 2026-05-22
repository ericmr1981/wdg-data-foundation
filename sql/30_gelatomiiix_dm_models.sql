-- Gelatomiiix｜DM 模型（三张主表）
-- 用途：月度收入/费用/利润汇总
-- 依赖：brand_gelatomiiix_ods.bank_txn, brand_gelatomiiix_dm.v_bank_txn_classified

------------------------------------------------------------
-- T5.1 收入月报（revenue_monthly）
------------------------------------------------------------
drop view if exists brand_gelatomiiix_dm.revenue_monthly cascade;

create view brand_gelatomiiix_dm.revenue_monthly as
select
    date_trunc('month', t.txn_time)::date as month,
    null::numeric as biz_revenue_amt,
    coalesce(sum(case when c.lvl1_code = 'REV_BIZ' then coalesce(t.in_amt,0) else 0 end), 0) as bank_revenue_amt,
    null::numeric as diff_amt
from brand_gelatomiiix_ods.bank_txn t
left join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where t.txn_time is not null
group by date_trunc('month', t.txn_time)::date
order by date_trunc('month', t.txn_time)::date desc;


------------------------------------------------------------
-- T5.2 费用月报（expense_monthly）
------------------------------------------------------------
drop view if exists brand_gelatomiiix_dm.expense_monthly cascade;

create view brand_gelatomiiix_dm.expense_monthly as
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
    from brand_gelatomiiix_ods.bank_txn t
    inner join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.txn_time is not null
      and t.out_amt > 0
) sub
group by month, lvl1_code, lvl2_code
order by month desc, total_out_amt desc;


------------------------------------------------------------
-- T5.2.1 一级费用趋势（v_expense_lvl1_monthly）
------------------------------------------------------------
drop view if exists brand_gelatomiiix_dm.v_expense_lvl1_monthly cascade;

create view brand_gelatomiiix_dm.v_expense_lvl1_monthly as
select
    e.month,
    e.lvl1_code,
    coalesce(l1.lvl1_name, e.lvl1_code) as lvl1_name,
    sum(e.total_out_amt) as total_out_amt,
    sum(e.txn_rows) as txn_rows,
    coalesce(l1.sort_order, 9999) as sort_order
from brand_gelatomiiix_dm.expense_monthly e
left join brand_gelatomiiix_cfg.dim_category_lvl1 l1
  on e.lvl1_code = l1.lvl1_code
where (l1.direction in ('out','any') or l1.direction is null)
group by e.month, e.lvl1_code, coalesce(l1.lvl1_name, e.lvl1_code), coalesce(l1.sort_order, 9999)
order by e.month desc, sort_order, total_out_amt desc;


------------------------------------------------------------
-- T5.3 利润月报（profit_monthly）
-- 口径：
--   profit_amt = bank_revenue_amt - expense_ex_build_amt
--   cashflow_amt = 收入总金额 - 支出总金额
--   gross_margin_rate = (营业收入 - 材料采购) / 营业收入
------------------------------------------------------------
drop view if exists brand_gelatomiiix_dm.profit_monthly cascade;

create view brand_gelatomiiix_dm.profit_monthly as
with revenue_agg as (
    select
        date_trunc('month', t.txn_time)::date as month,
        t.store_code,
        coalesce(sum(case when c.lvl1_code = 'REV_BIZ' then t.in_amt else 0 end), 0) as bank_revenue_amt,
        coalesce(sum(t.in_amt), 0) as total_in_amt
    from brand_gelatomiiix_ods.bank_txn t
    left join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.txn_time is not null
    group by date_trunc('month', t.txn_time)::date, t.store_code
),
expense_agg as (
    select
        date_trunc('month', t.txn_time)::date as month,
        t.store_code,
        coalesce(sum(t.out_amt), 0) as expense_total_amt,
        coalesce(sum(case when c.lvl1_code = 'EXP_BUILD' then t.out_amt else 0 end), 0) as expense_ex_build_amt,
        coalesce(sum(case when c.lvl1_code = 'EXP_MATERIAL' then t.out_amt else 0 end), 0) as material_purchase_amt
    from brand_gelatomiiix_ods.bank_txn t
    left join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.txn_time is not null
      and t.out_amt > 0
    group by date_trunc('month', t.txn_time)::date, t.store_code
)
select
    r.month,
    r.store_code,
    r.bank_revenue_amt,
    r.total_in_amt,
    e.expense_total_amt,
    e.expense_ex_build_amt,
    e.material_purchase_amt,
    (r.bank_revenue_amt - e.expense_ex_build_amt) as profit_amt,
    (r.total_in_amt - e.expense_total_amt) as cashflow_amt,
    case 
        when r.bank_revenue_amt = 0 then 0 
        else (r.bank_revenue_amt - e.material_purchase_amt) / r.bank_revenue_amt 
    end as gross_margin_rate
from revenue_agg r
left join expense_agg e on r.month = e.month and r.store_code = e.store_code
order by r.month desc, r.store_code;
