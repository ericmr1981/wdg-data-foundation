-- Yufeng｜T2.7 规则回归验证集 + T2.8 规则冲突/多命中统计
-- 用途：
--   T2.7: golden set（20~50条）用于规则修改后的回归验证
--   T2.8: 冲突统计 - 同一流水命中多条规则的排查
-- 依赖：yufeng_ods.bank_txn, yufeng_cfg.bank_rule_map, yufeng_dm.v_bank_txn_classified

------------------------------------------------------------
-- T2.7 规则回归验证集
------------------------------------------------------------

-- 创建回归验证集表：存储人工标注的期望分类
-- 使用方式：
--   1. 从 v_unclassified_top 或 bank_txn 抽样候选样本
--   2. 人工填入 expected_lvl1 / expected_lvl2
--   3. 运行回归检查查询对比期望 vs 实际
create table if not exists yufeng_dm.rule_regression_set (
    id              bigserial primary key,
    bank_txn_id     bigint not null unique,  -- FK -> yufeng_ods.bank_txn.id

    -- 期望分类（人工标注）
    expected_lvl1   text not null,
    expected_lvl2   text,

    -- 备注（说明为什么这么分类）
    note            text,

    -- 元数据
    created_by      text not null default 'ui',
    created_at      timestamptz not null default now()
);

-- 索引
create index if not exists idx_regression_bank_txn_id on yufeng_dm.rule_regression_set(bank_txn_id);

------------------------------------------------------------
-- T2.7 回归检查查询：对比期望 vs 当前分类结果
-- 输出：不一致的 bank_txn_id、期望分类、实际分类、差异原因
------------------------------------------------------------
drop view if exists yufeng_dm.v_rule_regression_check;

create view yufeng_dm.v_rule_regression_check as
select
    r.bank_txn_id,
    r.expected_lvl1,
    r.expected_lvl2,
    c.lvl1 as actual_lvl1,
    c.lvl2 as actual_lvl2,
    c.matched_rule_id,
    c.classified_source,

    -- 标记差异
    case
        when r.expected_lvl1 != c.lvl1 then 'lvl1_diff'
        when r.expected_lvl2 is distinct from c.lvl2 then 'lvl2_diff'
        else null
    end as diff_type,

    -- 原始流水信息（便于定位问题）
    t.txn_time,
    t.counterparty_name,
    t.summary,
    t.in_amt,
    t.out_amt,

    r.note as regression_note
from yufeng_dm.rule_regression_set r
inner join yufeng_dm.v_bank_txn_classified c on r.bank_txn_id = c.bank_txn_id
inner join yufeng_ods.bank_txn t on r.bank_txn_id = t.id
order by r.id;

------------------------------------------------------------
-- T2.7 候选样本生成查询（用于人工标注 expected）
-- 从以下来源抽样：
--   1. 未分类 Top（高金额/常见对手方）
--   2. 已分类中随机抽样（验证规则稳定性）
------------------------------------------------------------

-- 先删除依赖视图，确保幂等
DROP VIEW IF EXISTS yufeng_dm.v_rule_conflict_detail;
DROP VIEW IF EXISTS yufeng_dm.v_rule_conflict_summary;
DROP VIEW IF EXISTS yufeng_dm.v_rule_conflict_all;
DROP VIEW IF EXISTS yufeng_dm.v_regression_candidates;
DROP VIEW IF EXISTS yufeng_dm.v_rule_regression_check;

create view yufeng_dm.v_regression_candidates as
-- 来源1：未分类 Top 20（高金额/常见对手方）
select * from (
    select
        'unclassified_top' as source,
        t.id as bank_txn_id,
        t.txn_time,
        t.counterparty_name,
        t.summary,
        t.memo,
        t.in_amt,
        t.out_amt,
        c.lvl1 as current_lvl1,
        c.lvl2 as current_lvl2,
        c.classified_source,
        null as expected_lvl1,
        null as expected_lvl2
    from yufeng_ods.bank_txn t
    inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where c.classified_source = 'unclassified'
    order by abs(coalesce(t.in_amt, t.out_amt)) desc
    limit 30
) t1

union all

-- 来源2：已分类（rule）中随机抽样 20 条
select * from (
    select
        'classified_rule' as source,
        t.id as bank_txn_id,
        t.txn_time,
        t.counterparty_name,
        t.summary,
        t.memo,
        t.in_amt,
        t.out_amt,
        c.lvl1 as current_lvl1,
        c.lvl2 as current_lvl2,
        c.classified_source,
        c.lvl1 as expected_lvl1,
        c.lvl2 as expected_lvl2
    from yufeng_ods.bank_txn t
    inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where c.classified_source = 'rule'
    order by random()
    limit 20
) t2;

------------------------------------------------------------
-- T2.8 规则冲突/多命中统计
------------------------------------------------------------

-- 思路：遍历所有规则，找出同一流水命中多条规则的情况
-- 注意：当前 fn_classify_bank_txn 使用 first-match (priority 最小的)
--      本查询展示所有命中（即使被压制）的规则，供排查冲突

drop view if exists yufeng_dm.v_rule_conflict_all;

create view yufeng_dm.v_rule_conflict_all as
with matched_rules as (
    -- 展开：每条流水匹配到的所有规则
    select
        t.id as bank_txn_id,
        t.counterparty_name,
        t.summary,
        t.memo,
        t.in_amt,
        t.out_amt,
        r.rule_id,
        r.match_value,
        r.match_field,
        r.priority,
        r.lvl1 as rule_lvl1,
        r.lvl2 as rule_lvl2,
        row_number() over (
            partition by t.id
            order by r.priority asc
        ) as hit_order  -- 1=最终选中的规则
    from yufeng_ods.bank_txn t
    cross join yufeng_cfg.bank_rule_map r
    where r.enabled = true
      and (
        (r.direction = 'any')
        or (r.direction = 'in' and t.in_amt is not null and t.in_amt > 0)
        or (r.direction = 'out' and t.out_amt is not null and t.out_amt > 0)
      )
      and (
        (r.match_field = 'any' and (
            t.counterparty_name ilike '%' || r.match_value || '%'
            or t.summary ilike '%' || r.match_value || '%'
            or t.memo ilike '%' || r.match_value || '%'
            or t.purpose ilike '%' || r.match_value || '%'
        ))
        or (r.match_field = 'counterparty_name' and t.counterparty_name ilike '%' || r.match_value || '%')
        or (r.match_field = 'summary' and t.summary ilike '%' || r.match_value || '%')
        or (r.match_field = 'memo' and t.memo ilike '%' || r.match_value || '%')
        or (r.match_field = 'purpose' and t.purpose ilike '%' || r.match_value || '%'
        )
      )
),
-- 第二步：先计算窗口函数（包括命中数），然后再过滤
with_window as (
    select
        m.bank_txn_id,
        m.counterparty_name,
        m.summary,
        m.memo,
        m.in_amt,
        m.out_amt,
        m.rule_id,
        m.match_value,
        m.rule_lvl1,
        m.rule_lvl2,
        m.hit_order,
        count(*) over (partition by m.bank_txn_id) as hit_count
    from matched_rules m
)
select
    w.bank_txn_id,
    w.counterparty_name,
    w.summary,
    w.in_amt,
    w.out_amt,
    w.hit_count,

    -- 最终选中的规则（priority 最小）
    w.rule_id as selected_rule_id,
    w.match_value as selected_match_value,
    w.rule_lvl1 as selected_lvl1,
    w.rule_lvl2 as selected_lvl2,

    -- 被压制的规则列表（hit_order > 1）
    array_agg(
        case when w.hit_order > 1 then w.rule_id || ':' || w.match_value || '(' || w.rule_lvl1 || ')' end
    ) filter (where w.hit_order > 1) over (partition by w.bank_txn_id) as suppressed_rules,

    w.hit_order
from with_window w
where w.hit_order = 1  -- 只取最终选中的（用于找冲突）
order by w.bank_txn_id;

------------------------------------------------------------
-- T2.8 冲突汇总统计
-- 输出：冲突笔数、Top 冲突关键词/对手方
------------------------------------------------------------
drop view if exists yufeng_dm.v_rule_conflict_summary;

create view yufeng_dm.v_rule_conflict_summary as
with conflict_details as (
    -- 筛选出命中数 > 1 的流水（冲突）
    select
        c.bank_txn_id,
        c.counterparty_name,
        c.in_amt,
        c.out_amt,
        c.hit_count,
        c.selected_match_value
    from yufeng_dm.v_rule_conflict_all c
    where c.hit_count > 1
)
select
    -- 总体统计
    count(*) as conflict_txn_count,
    sum(hit_count) as total_rule_hits,

    -- Top 冲突关键词（被压制次数最多的 match_value）
    (select array_agg(selected_match_value)
     from (
        select selected_match_value, count(*) as cnt
        from conflict_details
        group by selected_match_value
        order by cnt desc
        limit 5
     ) k
    ) as top_conflict_keywords,

    -- Top 冲突对手方
    (select array_agg(counterparty_name)
     from (
        select counterparty_name, count(*) as cnt
        from conflict_details
        group by counterparty_name
        order by cnt desc
        limit 5
     ) k
    ) as top_conflict_counterparties,

    -- 冲突金额汇总
    sum(coalesce(in_amt, 0)) as total_conflict_in_amt,
    sum(coalesce(out_amt, 0)) as total_conflict_out_amt
from conflict_details;

------------------------------------------------------------
-- T2.8 冲突明细（命中数 > 1 的流水）
------------------------------------------------------------
drop view if exists yufeng_dm.v_rule_conflict_detail;

create view yufeng_dm.v_rule_conflict_detail as
select
    bank_txn_id,
    txn_time,
    counterparty_name,
    summary,
    in_amt,
    out_amt,
    hit_count,
    selected_rule_id,
    selected_match_value,
    selected_lvl1,
    selected_lvl2,
    suppressed_rules
from (
    select
        t.txn_time,
        c.*
    from yufeng_dm.v_rule_conflict_all c
    inner join yufeng_ods.bank_txn t on c.bank_txn_id = t.id
    where c.hit_count > 1
) sub
order by hit_count desc, abs(coalesce(in_amt, out_amt)) desc;

------------------------------------------------------------
-- 验证查询示例（执行前请确保依赖表和视图已创建）
------------------------------------------------------------

-- T2.7 候选样本：查看回归候选
-- select * from yufeng_dm.v_regression_candidates limit 5;

-- T2.7 回归检查：输出不一致清单
-- select * from yufeng_dm.v_rule_regression_check limit 5;

-- T2.7 回归检查：仅看有差异的
-- select * from yufeng_dm.v_rule_regression_check where diff_type is not null limit 5;

-- T2.8 冲突汇总统计
-- select * from yufeng_dm.v_rule_conflict_summary;

-- T2.8 冲突明细（命中数 > 1）
-- select * from yufeng_dm.v_rule_conflict_detail limit 5;

-- T2.8 查看具体某条流水的所有命中规则（调试用）
-- select
--     t.id as bank_txn_id,
--     r.rule_id,
--     r.match_value,
--     r.priority,
--     r.lvl1,
--     r.lvl2
-- from yufeng_ods.bank_txn t
-- cross join yufeng_cfg.bank_rule_map r
-- where t.id = :target_bank_txn_id
--   and r.enabled = true
--   and (
--     (r.match_field = 'any' and (
--         t.counterparty_name ilike '%' || r.match_value || '%'
--         or t.summary ilike '%' || r.match_value || '%'
--         or t.memo ilike '%' || r.match_value || '%'
--         or t.purpose ilike '%' || r.match_value || '%'
--     ))
--     or (r.match_field = 'counterparty_name' and t.counterparty_name ilike '%' || r.match_value || '%')
--     or (r.match_field = 'summary' and t.summary ilike '%' || r.match_value || '%')
--     or (r.match_field = 'memo' and t.memo ilike '%' || r.match_value || '%')
--     or (r.match_field = 'purpose' and t.purpose ilike '%' || r.match_value || '%')
--   )
-- order by r.priority;
