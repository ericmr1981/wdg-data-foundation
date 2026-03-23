-- Yufeng｜T5 DM 模型（三张主表）
-- 用途：月度收入/费用/利润汇总
-- 依赖：yufeng_ods.bank_txn, yufeng_dm.v_bank_txn_classified
-- 选择：使用 VIEW 而非 TABLE，优点是无需维护、随源数据自动更新、便于快速验收

------------------------------------------------------------
-- T5.1 收入月报（revenue_monthly）
-- 输出：month, biz_revenue_amt（业务口径）, bank_revenue_amt（银行口径）, diff_amt
-- 说明：
--   - biz_revenue_amt: 暂无可用营业数据（Yufeng 未导入 sales 表），留 NULL
--   - bank_revenue_amt: 来自 v_bank_txn_classified 中 lvl1='营业收入' 的 in_amt 汇总
--   - diff_amt: bank_revenue_amt - biz_revenue_amt（业务-银行差异）
------------------------------------------------------------
drop view if exists yufeng_dm.revenue_monthly;

create view yufeng_dm.revenue_monthly as
select
    date_trunc('month', t.txn_time)::date as month,

    -- 业务口径（暂无可用数据，留 NULL）
    -- TODO: 待 Yufeng 导入营业数据后，从 bonjur_ods.sales_monthly 或 yufeng_ods.sales_* 获取
    null::numeric as biz_revenue_amt,

    -- 银行口径：lvl1='营业收入' 的 in_amt 汇总
    coalesce(sum(case when c.lvl1 = '营业收入' then c.in_amt else 0 end), 0) as bank_revenue_amt,

    -- 差异：银行 - 业务（当前 = bank - NULL = NULL）
    -- 当 biz_revenue_amt 有值后，改为: bank_revenue_amt - biz_revenue_amt
    case
        when null is null then null  -- 业务口径暂无数据
        else sum(case when c.lvl1 = '营业收入' then c.in_amt else 0 end) - null
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
drop view if exists yufeng_dm.expense_monthly;

create view yufeng_dm.expense_monthly as
select
    month,
    lvl1,
    lvl2,
    sum(out_amt) as total_out_amt,
    count(*) as txn_rows

from (
    select
        date_trunc('month', t.txn_time)::date as month,
        c.lvl1,
        c.lvl2,
        coalesce(t.out_amt, 0) as out_amt

    from yufeng_ods.bank_txn t
    inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.txn_time is not null
      and t.out_amt > 0  -- 只统计支出
) sub
group by month, lvl1, lvl2
order by month desc, total_out_amt desc;


------------------------------------------------------------
-- T5.3 利润月报（profit_monthly）
-- 输出：month, bank_revenue_amt, total_expense_amt, profit_amt, biz_revenue_amt, diff_amt
-- 说明：
--   - profit_amt = bank_revenue_amt - total_expense_amt
--   - biz_revenue_amt/diff_amt 保留（当业务数据可用时）
------------------------------------------------------------
drop view if exists yufeng_dm.profit_monthly;

create view yufeng_dm.profit_monthly as
select
    date_trunc('month', t.txn_time)::date as month,

    -- 收入（银行口径）
    coalesce(sum(case when c.lvl1 = '营业收入' then c.in_amt else 0 end), 0) as bank_revenue_amt,

    -- 费用（银行口径汇总所有 out_amt）
    coalesce(sum(case when c.lvl1 != '营业收入' then c.out_amt else 0 end), 0) as total_expense_amt,

    -- 利润 = 收入 - 费用
    coalesce(sum(case when c.lvl1 = '营业收入' then c.in_amt else 0 end), 0)
    - coalesce(sum(case when c.lvl1 != '营业收入' then c.out_amt else 0 end), 0) as profit_amt,

    -- 业务口径（暂无数据，留 NULL）
    null::numeric as biz_revenue_amt,

    -- 差异（暂无业务数据时为 NULL）
    null::numeric as diff_amt

from yufeng_ods.bank_txn t
left join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where t.txn_time is not null
group by date_trunc('month', t.txn_time)::date
order by date_trunc('month', t.txn_time)::date desc;


------------------------------------------------------------
-- 验证查询示例
------------------------------------------------------------

-- T5.1 收入月报
-- select * from yufeng_dm.revenue_monthly;

-- T5.2 费用月报（按月+分类）
-- select * from yufeng_dm.expense_monthly;

-- T5.3 费用月报（按月汇总，简化版）
-- select month, sum(total_out_amt) as total_expense_amt
-- from yufeng_dm.expense_monthly
-- group by month
-- order by month desc;

-- T5.4 利润月报
-- select * from yufeng_dm.profit_monthly;
