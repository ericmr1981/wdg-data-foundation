-- ============================================================
-- 通用三大财务报表视图（模板，使用 yufeng_* 前缀）
-- 依赖: yufeng_ods.bank_txn
--       yufeng_dm.bank_txn_classified_snapshot
--       yufeng_cfg.dim_category_lvl1 / lvl2
-- 说明: 从已分类银行流水按门店+月份+分类聚合
--       每个 lvl1/lvl2 类别的 amount 取净额（in_amt - out_amt）
--       收入方向为正，支出方向为负
-- ============================================================

-- === 利润表 ===
drop view if exists yufeng_dm.v_profit_statement cascade;

create view yufeng_dm.v_profit_statement as
with classified_txns as (
    select
        t.store_code,
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.in_amt, 0) as in_amt,
        coalesce(t.out_amt, 0) as out_amt
    from yufeng_ods.bank_txn t
    join yufeng_dm.bank_txn_classified_snapshot c on c.bank_txn_id = t.id
    where c.classified_source in ('rule', 'override')
),
category_agg as (
    select
        month,
        store_code,
        lvl1_code,
        lvl2_code,
        sum(in_amt) as total_in,
        sum(out_amt) as total_out,
        count(*) as txn_rows
    from classified_txns
    group by month, store_code, lvl1_code, lvl2_code
)
select
    a.month,
    a.store_code,
    case
        when l1.direction = 'in' then 'revenue'
        else 'expense'
    end as section,
    a.lvl1_code,
    l1.lvl1_name,
    a.lvl2_code,
    l2.lvl2_name,
    coalesce(l1.direction, 'out') as direction,
    (a.total_in - a.total_out) as amount,
    a.txn_rows,
    case
        when a.lvl1_code = 'REV_BIZ' then 10
        when a.lvl1_code = 'REV_OTHER' then 20
        when a.lvl1_code = 'MATERIAL' then 100
        when a.lvl1_code = 'TAX_SURCHARGE' then 105
        when a.lvl1_code = 'SHIP' then 110
        when a.lvl1_code = 'HR' then 200
        when a.lvl1_code = 'RENT_UTIL' then 210
        when a.lvl1_code = 'MKT' then 220
        when a.lvl1_code = 'ADMIN' then 230
        when a.lvl1_code = 'BUILD' then 240
        when a.lvl1_code = 'EXP_OTHER' then 250
        else 999
    end as sort_order,
    case
        when l1.direction = 'in' then 0
        else 1
    end as indent_level
from category_agg a
left join yufeng_cfg.dim_category_lvl1 l1 on l1.lvl1_code = a.lvl1_code
left join yufeng_cfg.dim_category_lvl2 l2 on l2.lvl1_code = a.lvl1_code and l2.lvl2_code = a.lvl2_code;

-- === 现金流量表 ===
drop view if exists yufeng_dm.v_cashflow_statement cascade;

create view yufeng_dm.v_cashflow_statement as
with classified_txns as (
    select
        t.store_code,
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.in_amt, 0) as in_amt,
        coalesce(t.out_amt, 0) as out_amt
    from yufeng_ods.bank_txn t
    join yufeng_dm.bank_txn_classified_snapshot c on c.bank_txn_id = t.id
    where c.classified_source in ('rule', 'override')
)
select
    month,
    store_code,
    case
        when lvl1_code = 'REV_BIZ' then 'operating'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'INTEREST_IN' then 'operating'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'REFUND_IN' then 'operating'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'TAX_REFUND' then 'operating'
        when lvl1_code in ('HR', 'MATERIAL', 'RENT_UTIL', 'MKT', 'ADMIN', 'SHIP', 'TAX_SURCHARGE', 'EXP_OTHER') then 'operating'
        when lvl1_code = 'BUILD' then 'investing'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'INVEST_IN' then 'investing'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'LOAN_IN' then 'financing'
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'BORROW_IN' then 'financing'
        when lvl1_code = 'EXP_OTHER' and lvl2_code = 'REPAY' then 'financing'
        else 'unclassified'
    end as activity,
    lvl1_code,
    lvl2_code,
    sum(in_amt) as total_in,
    sum(out_amt) as total_out,
    sum(in_amt - out_amt) as net_amount,
    count(*) as txn_rows,
    case
        when lvl1_code = 'REV_BIZ' then 10
        when lvl1_code = 'REV_OTHER' and lvl2_code in ('INTEREST_IN', 'REFUND_IN', 'TAX_REFUND') then 20
        when lvl1_code = 'HR' then 110
        when lvl1_code = 'MATERIAL' then 120
        when lvl1_code = 'RENT_UTIL' then 130
        when lvl1_code = 'MKT' then 140
        when lvl1_code = 'ADMIN' then 150
        when lvl1_code = 'SHIP' then 160
        when lvl1_code = 'TAX_SURCHARGE' then 165
        when lvl1_code = 'EXP_OTHER' and lvl2_code = 'TAX' then 170
        when lvl1_code = 'EXP_OTHER' then 180
        when lvl1_code = 'BUILD' then 210
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'INVEST_IN' then 220
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'LOAN_IN' then 310
        when lvl1_code = 'REV_OTHER' and lvl2_code = 'BORROW_IN' then 320
        when lvl1_code = 'EXP_OTHER' and lvl2_code = 'REPAY' then 330
        else 999
    end as sort_order
from classified_txns
group by month, store_code, lvl1_code, lvl2_code;

-- === 资产负债表 ===
-- 从银行流水中的 balance_amt（银行对账单时点余额）取各月末货币资金值
-- 用 balance_amt 而非累计 net_cashflow，是因为：
--   1. 包含期初余额——银行对账单已有起始余额
--   2. 不会出现负的"货币资金"（除非实际透支）
--   3. 与银行对账单一致，具备可验证性
drop view if exists yufeng_dm.v_balance_sheet cascade;

create view yufeng_dm.v_balance_sheet as
with monthly_balance as (
    -- 取每个门店每月最后一条有 balance_amt 的流水
    select distinct on (date_trunc('month', t.txn_time)::date, t.store_code)
        date_trunc('month', t.txn_time)::date as month,
        t.store_code,
        t.balance_amt as cash_balance
    from yufeng_ods.bank_txn t
    where t.balance_amt is not null
    order by date_trunc('month', t.txn_time)::date, t.store_code, t.txn_time desc
),
classified_txns as (
    select
        t.store_code,
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1_code,
        c.lvl2_code,
        coalesce(t.in_amt, 0) as in_amt,
        coalesce(t.out_amt, 0) as out_amt
    from yufeng_ods.bank_txn t
    join yufeng_dm.bank_txn_classified_snapshot c on c.bank_txn_id = t.id
    where c.classified_source in ('rule', 'override')
),
loans_received as (
    select
        month,
        store_code,
        sum(in_amt) as total_loan
    from classified_txns
    where (lvl1_code = 'REV_OTHER' and lvl2_code in ('LOAN_IN', 'BORROW_IN'))
    group by month, store_code
),
loans_repaid as (
    select
        month,
        store_code,
        sum(out_amt) as total_repay
    from classified_txns
    where (lvl1_code = 'EXP_OTHER' and lvl2_code = 'REPAY')
    group by month, store_code
),
capital_invested as (
    select
        month,
        store_code,
        sum(in_amt) as total_capital
    from classified_txns
    where (lvl1_code = 'REV_OTHER' and lvl2_code = 'INVEST_IN')
    group by month, store_code
),
cumulative_items as (
    select
        c.month,
        c.store_code,
        c.cash_balance,
        coalesce(sum(l.total_loan) over (partition by c.store_code order by c.month), 0) as cum_loan,
        coalesce(sum(r.total_repay) over (partition by c.store_code order by c.month), 0) as cum_repay,
        coalesce(sum(cap.total_capital) over (partition by c.store_code order by c.month), 0) as cum_capital
    from monthly_balance c
    left join loans_received l on l.month = c.month and l.store_code = c.store_code
    left join loans_repaid r on r.month = c.month and r.store_code = c.store_code
    left join capital_invested cap on cap.month = c.month and cap.store_code = c.store_code
)
select
    month,
    store_code,
    cash_balance,
    (cum_loan - cum_repay) as loan_balance,
    cum_capital as capital_balance,
    0 as retained_earnings  -- computed at query time by API from v_profit_statement
from cumulative_items
order by store_code, month;
