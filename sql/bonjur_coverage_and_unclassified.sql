-- Bonjur｜覆盖率统计 + 未分类清单
-- 用途：与 yufeng_dm 对齐的覆盖率月度统计 + 未分类 TopN + 未分类明细
-- 依赖：bonjur_ods.bank_txn, bonjur_dm.v_bank_txn_classified

------------------------------------------------------------
-- 覆盖率统计视图（按月，含 in/out 分开统计）
------------------------------------------------------------
drop view if exists bonjur_dm.v_coverage_monthly;

create view bonjur_dm.v_coverage_monthly as
select
    month,

    -- 笔数统计
    total_rows,
    covered_rows,
    unclassified_rows,
    round(coalesce(covered_rows * 100.0 / nullif(total_rows, 0), 0), 2) as coverage_rate_rows,

    -- 转入金额统计（in_amt）
    coalesce(total_in_amt, 0) as total_in_amt,
    coalesce(covered_in_amt, 0) as covered_in_amt,
    coalesce(unclassified_in_amt, 0) as unclassified_in_amt,
    round(coalesce(covered_in_amt * 100.0 / nullif(total_in_amt, 0), 0), 2) as coverage_rate_in_amt,

    -- 转出金额统计（out_amt）
    coalesce(total_out_amt, 0) as total_out_amt,
    coalesce(covered_out_amt, 0) as covered_out_amt,
    coalesce(unclassified_out_amt, 0) as unclassified_out_amt,
    round(coalesce(covered_out_amt * 100.0 / nullif(total_out_amt, 0), 0), 2) as coverage_rate_out_amt

from (
    select
        date_trunc('month', t.txn_time)::date as month,

        -- 笔数
        count(*) as total_rows,
        count(case when c.classified_source in ('override', 'rule') then 1 end) as covered_rows,
        count(case when c.classified_source = 'unclassified' then 1 end) as unclassified_rows,

        -- in_amt
        sum(coalesce(t.in_amt, 0)) as total_in_amt,
        sum(case when c.classified_source in ('override', 'rule') then coalesce(t.in_amt, 0) else 0 end) as covered_in_amt,
        sum(case when c.classified_source = 'unclassified' then coalesce(t.in_amt, 0) else 0 end) as unclassified_in_amt,

        -- out_amt
        sum(coalesce(t.out_amt, 0)) as total_out_amt,
        sum(case when c.classified_source in ('override', 'rule') then coalesce(t.out_amt, 0) else 0 end) as covered_out_amt,
        sum(case when c.classified_source = 'unclassified' then coalesce(t.out_amt, 0) else 0 end) as unclassified_out_amt

    from bonjur_ods.bank_txn t
    left join bonjur_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    group by date_trunc('month', t.txn_time)::date
) sub
order by month desc;

------------------------------------------------------------
-- 未分类 Top（对方单位/摘要关键词）
------------------------------------------------------------
drop view if exists bonjur_dm.v_unclassified_top;

create view bonjur_dm.v_unclassified_top as
select
    date_trunc('month', t.txn_time)::date as month,
    t.counterparty_name,
    t.summary,
    t.memo,

    coalesce(t.counterparty_name, '') || ' | ' || coalesce(t.summary, '') || ' | ' || coalesce(t.memo, '') as combined_text,

    count(*) as txn_rows,
    coalesce(sum(coalesce(t.in_amt, 0)), 0) as in_amt,
    coalesce(sum(coalesce(t.out_amt, 0)), 0) as out_amt,
    coalesce(sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0)), 0) as total_amt

from bonjur_ods.bank_txn t
inner join bonjur_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where c.classified_source = 'unclassified'
group by date_trunc('month', t.txn_time)::date, t.counterparty_name, t.summary, t.memo
order by month desc, txn_rows desc, total_amt desc;

------------------------------------------------------------
-- 未分类明细（支持按月过滤 + drilldown）
------------------------------------------------------------
drop view if exists bonjur_dm.v_unclassified_detail;

create view bonjur_dm.v_unclassified_detail as
select
    date_trunc('month', t.txn_time)::date as month,
    t.id as bank_txn_id,
    t.txn_time,
    t.counterparty_name,
    t.summary,
    t.memo,
    t.in_amt,
    t.out_amt,
    t.balance_amt,
    t.source_file_id,

    coalesce(t.counterparty_name, '') || ' | ' || coalesce(t.summary, '') || ' | ' || coalesce(t.memo, '') as combined_text
from bonjur_ods.bank_txn t
inner join bonjur_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where c.classified_source = 'unclassified'
order by month desc, t.txn_time desc;

------------------------------------------------------------
-- 验证查询示例
------------------------------------------------------------
-- select * from bonjur_dm.v_coverage_monthly;
-- select * from bonjur_dm.v_unclassified_top limit 20;
-- select * from bonjur_dm.v_unclassified_detail where month = date '2026-02-01' limit 200;
