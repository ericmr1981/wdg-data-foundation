-- =============================================================================
-- yufeng_match_preview.sql
-- 用途：match_value 命中预览 - 给定候选值，返回历史命中数与分类分布
-- 作者：Claude Code
-- 执行：幂等，可重复执行
-- =============================================================================

------------------------------------------------------------
-- 1. 命中预览视图：按 match_value 汇总历史分类
-- 说明：根据 match_value（contains 匹配）统计命中数与 lvl1/lvl2 分布
-- 约束：counterparty_name 的 contains 规则要求 match_value 长度≥3
------------------------------------------------------------
create or replace view yufeng_dm.v_match_preview as
select
    -- 输入的 match_value
    r.match_value,

    -- 汇总统计
    count(*) as hit_count,
    sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0)) as total_amt,

    -- 分类分布（lvl1 维度）
    count(*) filter (where c.lvl1 = '营业收入') as cnt_营业收入,
    count(*) filter (where c.lvl1 = '运费') as cnt_运费,
    count(*) filter (where c.lvl1 = '租金物业') as cnt_租金物业,
    count(*) filter (where c.lvl1 = '人力') as cnt_人力,
    count(*) filter (where c.lvl1 = '材料采购') as cnt_材料采购,
    count(*) filter (where c.lvl1 = '管理费用') as cnt_管理费用,
    count(*) filter (where c.lvl1 = '销售费用') as cnt_销售费用,
    count(*) filter (where c.lvl1 = '手续费') as cnt_手续费,
    count(*) filter (where c.lvl1 = '税金') as cnt_税金,
    count(*) filter (where c.lvl1 = '往来/借款') as cnt_往来借款,
    count(*) filter (where c.lvl1 = '往来/注资') as cnt_往来注资,
    count(*) filter (where c.lvl1 = '往来/还款') as cnt_往来还款,
    count(*) filter (where c.lvl1 = '往来/其他') as cnt_往来其他,
    count(*) filter (where c.lvl1 = '未分类') as cnt_未分类,
    count(*) filter (where c.lvl1 not in (
        '营业收入', '运费', '租金物业', '人力', '材料采购', '管理费用',
        '销售费用', '手续费', '税金', '往来/借款', '往来/注资',
        '往来/还款', '往来/其他', '未分类'
    )) as cnt_其他,

    -- 主要分类（命中最多的 lvl1）
    (
        select c2.lvl1
        from yufeng_dm.v_bank_txn_classified c2
        where c2.lvl1 != '未分类'
          and (
            t.counterparty_name ilike '%' || r.match_value || '%'
            or t.summary ilike '%' || r.match_value || '%'
            or t.memo ilike '%' || r.match_value || '%'
            or t.purpose ilike '%' || r.match_value || '%'
          )
        group by c2.lvl1
        order by count(*) desc
        limit 1
    ) as primary_lvl1,

    -- 主要分类（命中最多的 lvl2）
    (
        select c2.lvl2
        from yufeng_dm.v_bank_txn_classified c2
        where c2.lvl2 is not null
          and (
            t.counterparty_name ilike '%' || r.match_value || '%'
            or t.summary ilike '%' || r.match_value || '%'
            or t.memo ilike '%' || r.match_value || '%'
            or t.purpose ilike '%' || r.match_value || '%'
          )
        group by c2.lvl2
        order by count(*) desc
        limit 1
    ) as primary_lvl2

from yufeng_cfg.bank_rule_map r
inner join yufeng_ods.bank_txn t on (
    t.counterparty_name ilike '%' || r.match_value || '%'
    or t.summary ilike '%' || r.match_value || '%'
    or t.memo ilike '%' || r.match_value || '%'
    or t.purpose ilike '%' || r.match_value || '%'
)
inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where r.enabled = true
  and length(r.match_value) >= 3  -- 约束：counterparty_name 的 contains 规则要求 ≥3
group by r.match_value;

------------------------------------------------------------
-- 2. 快速命中预览函数（给定 match_value 实时查询）
-- 说明：用于 UI 实时预览，输入候选值立即返回命中统计
-- 性能：限制返回前 20 条分类分布
------------------------------------------------------------
create or replace function yufeng_dm.fn_preview_match_value(p_match_value text)
returns table (
    match_value text,
    hit_count bigint,
    total_amt numeric,
    primary_lvl1 text,
    primary_lvl2 text,
    lvl1_distribution jsonb,
    lvl2_distribution jsonb
) as $$
begin
    return query
    select
        p_match_value::text as match_value,
        count(*)::bigint as hit_count,
        sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))::numeric as total_amt,

        -- 主要分类
        (
            select c2.lvl1
            from yufeng_dm.v_bank_txn_classified c2
            where c2.lvl1 != '未分类'
              and (
                t.counterparty_name ilike '%' || p_match_value || '%'
                or t.summary ilike '%' || p_match_value || '%'
                or t.memo ilike '%' || p_match_value || '%'
                or t.purpose ilike '%' || p_match_value || '%'
              )
            group by c2.lvl1
            order by count(*) desc
            limit 1
        )::text as primary_lvl1,

        (
            select c2.lvl2
            from yufeng_dm.v_bank_txn_classified c2
            where c2.lvl2 is not null
              and (
                t.counterparty_name ilike '%' || p_match_value || '%'
                or t.summary ilike '%' || p_match_value || '%'
                or t.memo ilike '%' || p_match_value || '%'
                or t.purpose ilike '%' || p_match_value || '%'
              )
            group by c2.lvl2
            order by count(*) desc
            limit 1
        )::text as primary_lvl2,

        -- lvl1 分布 JSON
        (
            select jsonb_object_agg(lvl1, cnt)
            from (
                select c2.lvl1, count(*)::bigint as cnt
                from yufeng_dm.v_bank_txn_classified c2
                where (
                    t.counterparty_name ilike '%' || p_match_value || '%'
                    or t.summary ilike '%' || p_match_value || '%'
                    or t.memo ilike '%' || p_match_value || '%'
                    or t.purpose ilike '%' || p_match_value || '%'
                )
                group by c2.lvl1
                order by cnt desc
                limit 15
            ) sub
        )::jsonb as lvl1_distribution,

        -- lvl2 分布 JSON
        (
            select jsonb_object_agg(lvl2, cnt)
            from (
                select c2.lvl2, count(*)::bigint as cnt
                from yufeng_dm.v_bank_txn_classified c2
                where c2.lvl2 is not null
                  and (
                    t.counterparty_name ilike '%' || p_match_value || '%'
                    or t.summary ilike '%' || p_match_value || '%'
                    or t.memo ilike '%' || p_match_value || '%'
                    or t.purpose ilike '%' || p_match_value || '%'
                  )
                group by c2.lvl2
                order by cnt desc
                limit 15
            ) sub
        )::jsonb as lvl2_distribution

    from yufeng_ods.bank_txn t
    inner join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where (
        t.counterparty_name ilike '%' || p_match_value || '%'
        or t.summary ilike '%' || p_match_value || '%'
        or t.memo ilike '%' || p_match_value || '%'
        or t.purpose ilike '%' || p_match_value || '%'
    )
    group by p_match_value;
end;
$$ language plpgsql;

------------------------------------------------------------
-- 3. 验证查询示例
------------------------------------------------------------
-- 预览单个候选值
-- select * from yufeng_dm.fn_preview_match_value('美团');

-- 查看已有规则的命中预览
-- select * from yufeng_dm.v_match_preview order by hit_count desc limit 20;

------------------------------------------------------------
-- 4. 软阀门 KPI 视图：未分类统计
-- 说明：固定展示在 /pipeline 页面
------------------------------------------------------------
create or replace view yufeng_dm.v_soft_gate_kpi as
select
    -- 未分类条数
    (select count(*)::bigint
     from yufeng_dm.v_bank_txn_classified c
     where c.lvl1 = '未分类') as unclassified_count,

    -- 未分类金额
    (select sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))
     from yufeng_dm.v_bank_txn_classified c
     inner join yufeng_ods.bank_txn t on c.bank_txn_id = t.id
     where c.lvl1 = '未分类') as unclassified_amt,

    -- 总金额
    (select sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))
     from yufeng_ods.bank_txn t) as total_amt,

    -- 未分类金额占比
    (
        (select sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))
         from yufeng_dm.v_bank_txn_classified c
         inner join yufeng_ods.bank_txn t on c.bank_txn_id = t.id
         where c.lvl1 = '未分类')
        /
        nullif((select sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))
                 from yufeng_ods.bank_txn t), 0)
        * 100
    )::numeric(5,2) as unclassified_pct;

------------------------------------------------------------
-- 5. 未分类 Top 关键词/对方单位（软阀门推荐）
-- 说明：用于补规则建议
------------------------------------------------------------
create or replace view yufeng_dm.v_unclassified_top_keywords as
select
    c.counterparty_name,
    c.summary,
    c.memo,
    count(*) as txn_count,
    sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0)) as total_amt,
    -- 推荐分类（基于现有规则推断）
    (
        select r.lvl1
        from yufeng_cfg.bank_rule_map r
        where r.enabled = true
          and (
            r.match_field = 'any'
            or r.match_field = 'counterparty_name'
            or r.match_field = 'summary'
            or r.match_field = 'memo'
            or r.match_field = 'purpose'
          )
          and (
            c.counterparty_name ilike '%' || r.match_value || '%'
            or c.summary ilike '%' || r.match_value || '%'
            or c.memo ilike '%' || r.match_value || '%'
          )
        order by r.priority asc
        limit 1
    ) as suggested_lvl1
from yufeng_dm.v_bank_txn_classified c
inner join yufeng_ods.bank_txn t on c.bank_txn_id = t.id
where c.lvl1 = '未分类'
group by c.counterparty_name, c.summary, c.memo
order by txn_count desc
limit 20;

------------------------------------------------------------
-- 验证查询
------------------------------------------------------------
-- select * from yufeng_dm.v_soft_gate_kpi;
-- select * from yufeng_dm.v_unclassified_top_keywords;