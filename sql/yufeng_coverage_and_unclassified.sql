-- Yufeng｜T2.5 覆盖率统计 + T2.6 未分类清单
-- 用途：优化版覆盖率月度统计 + 未分类清单 TopN + 明细查询
-- 依赖：yufeng_ods.bank_txn, yufeng_cfg.bank_rule_map, yufeng_dm.bank_txn_override, yufeng_dm.v_bank_txn_classified
-- 修复：增加 coalesce 兜底避免 NULL 传播（NaN 问题从 import 脚本修复后此处为双重保险）
-- 注意：PostgreSQL numeric 类型不支持 NaN，NaN 问题应在导入层修复

------------------------------------------------------------
-- T2.5 覆盖率统计视图（按月，含 in/out 分开统计）
------------------------------------------------------------
-- 改进：
-- 1. 使用 classified_source 直接判断（非函数调用，效率更高）
-- 2. 区分 in_amt / out_amt 的统计
-- 3. 增加 coverage_rate_rows / coverage_rate_in_amt / coverage_rate_out_amt
-- 4. 外层再套一层 coalesce 兜底（双重保险）
drop view if exists yufeng_dm.v_coverage_monthly;

create view yufeng_dm.v_coverage_monthly as
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
        to_char(t.txn_time, 'YYYY-MM') as month,

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

    from yufeng_ods.bank_txn t
    left join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    group by to_char(t.txn_time, 'YYYY-MM')
) sub
order by month desc;

------------------------------------------------------------
-- T2.6 未分类清单视图（Top 对方单位/摘要关键词）
-- 改进：支持按月过滤，输出可用于补规则的汇总
-- 修复：增加 NULLIF 兜底避免 NaN 传播
------------------------------------------------------------
drop view if exists yufeng_dm.v_unclassified_top;

create view yufeng_dm.v_unclassified_top as
select
    to_char(t.txn_time, 'YYYY-MM') as month,
    t.counterparty_name,
    t.summary,
    t.memo,

    -- 组合关键词（用于快速判断）
    coalesce(t.counterparty_name, '') || ' | ' || coalesce(t.summary, '') || ' | ' || coalesce(t.memo, '') as combined_text,

    count(*) as txn_rows,
    coalesce(sum(coalesce(t.in_amt, 0)), 0) as in_amt,
    coalesce(sum(coalesce(t.out_amt, 0)), 0) as out_amt,
    coalesce(sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0)), 0) as total_amt

from yufeng_ods.bank_txn t
inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where c.classified_source = 'unclassified'
group by to_char(t.txn_time, 'YYYY-MM'), t.counterparty_name, t.summary, t.memo
order by month desc, txn_rows desc, total_amt desc;

------------------------------------------------------------
-- T2.6 未分类明细查询（支持按月过滤 + drilldown 到 bank_txn_id）
-- 用途：UI 展示未分类流水明细，支持跳转到原始流水
------------------------------------------------------------
drop view if exists yufeng_dm.v_unclassified_detail;

create view yufeng_dm.v_unclassified_detail as
select
    to_char(t.txn_time, 'YYYY-MM') as month,
    t.id as bank_txn_id,
    t.txn_time,
    t.counterparty_name,
    t.summary,
    t.memo,
    t.in_amt,
    t.out_amt,
    t.balance_amt,
    t.source_file_id,

    -- 组合关键词（便于快速浏览）
    coalesce(t.counterparty_name, '') || ' | ' || coalesce(t.summary, '') || ' | ' || coalesce(t.memo, '') as combined_text
from yufeng_ods.bank_txn t
inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where c.classified_source = 'unclassified'
order by month desc, t.txn_time desc;

------------------------------------------------------------
-- 验证查询示例
------------------------------------------------------------

-- T2.5 覆盖率统计（按月）
-- select * from yufeng_dm.v_coverage_monthly;

-- T2.6 未分类汇总 Top 20（默认全部月份）
-- select * from yufeng_dm.v_unclassified_top limit 20;

-- T2.6 未分类汇总（指定月份，如 2025-03）
-- select * from yufeng_dm.v_unclassified_top where month = '2025-03' limit 20;

-- T2.6 未分类明细（指定月份，跳转到原始流水）
-- select * from yufeng_dm.v_unclassified_detail where month = '2025-03';

-- T2.6 未分类明细（指定关键词组合，查看是否有类似流水可批量处理）
-- select * from yufeng_dm.v_unclassified_detail
-- where counterparty_name = '某个单位' or summary like '%某个关键词%';
