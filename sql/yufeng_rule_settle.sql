-- Yufeng｜规则沉淀 + 冲突检查 + 双重匹配（AND）SQL
-- 用途：扩展 bank_rule_map 支持双条件匹配，更新分类函数
-- 执行顺序：在 yufeng_apply_classification.sql 之后执行

------------------------------------------------------------
-- T1. 扩展规则表：支持双条件匹配（AND）
------------------------------------------------------------
-- 为 bank_rule_map 表增加第二匹配条件列
alter table yufeng_cfg.bank_rule_map
add column if not exists match_field2 text,  -- 第二匹配字段：counterparty_name | summary | memo | purpose
add column if not exists match_value2 text;   -- 第二匹配关键词

-- 创建索引加速双条件查询
create index if not exists idx_bank_rule_match_fields
on yufeng_cfg.bank_rule_map(match_field, match_value, match_field2, match_value2);

------------------------------------------------------------
-- T2. 更新分类函数：支持 AND 匹配
------------------------------------------------------------
create or replace function yufeng_dm.fn_classify_bank_txn(p_bank_txn_id bigint)
returns yufeng_dm.classify_result as $$
declare
    v_counterparty_name text;
    v_summary text;
    v_memo text;
    v_purpose text;
    v_in_amt numeric;
    v_out_amt numeric;

    v_rule_id bigint;
    v_lvl1 text;
    v_lvl2 text;
    v_classified_source text;

    v_match1 boolean;
    v_match2 boolean;

    rec record;
begin
    -- 获取原始流水字段
    select
        t.counterparty_name,
        t.summary,
        t.memo,
        t.purpose,
        t.in_amt,
        t.out_amt
    into v_counterparty_name, v_summary, v_memo, v_purpose, v_in_amt, v_out_amt
    from yufeng_ods.bank_txn t
    where t.id = p_bank_txn_id;

    -- Step 1: 检查 override（优先级最高）
    select o.lvl1, o.lvl2, o.bank_txn_id
    into v_lvl1, v_lvl2, v_rule_id
    from yufeng_dm.bank_txn_override o
    where o.bank_txn_id = p_bank_txn_id;

    if found then
        v_classified_source := 'override';
        return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
    end if;

    -- Step 2: 检查规则匹配（first-match by priority）
    -- 支持双条件 AND 匹配：当 match_field2 非空时，必须同时满足两个条件
    for rec in (
        select r.rule_id, r.lvl1, r.lvl2, r.priority,
               r.match_field, r.match_value, r.match_field2, r.match_value2
        from yufeng_cfg.bank_rule_map r
        where r.enabled = true
          and (
            (r.direction = 'any')
            or (r.direction = 'in' and v_in_amt is not null and v_in_amt > 0)
            or (r.direction = 'out' and v_out_amt is not null and v_out_amt > 0)
          )
        order by r.priority asc
    ) loop
        -- 条件1：主匹配字段
        v_match1 := false;
        if rec.match_field = 'any' then
            v_match1 := (
                v_counterparty_name ilike '%' || rec.match_value || '%'
                or v_summary ilike '%' || rec.match_value || '%'
                or v_memo ilike '%' || rec.match_value || '%'
                or v_purpose ilike '%' || rec.match_value || '%'
            );
        elsif rec.match_field = 'counterparty_name' then
            v_match1 := (v_counterparty_name ilike '%' || rec.match_value || '%');
        elsif rec.match_field = 'summary' then
            v_match1 := (v_summary ilike '%' || rec.match_value || '%');
        elsif rec.match_field = 'memo' then
            v_match1 := (v_memo ilike '%' || rec.match_value || '%');
        elsif rec.match_field = 'purpose' then
            v_match1 := (v_purpose ilike '%' || rec.match_value || '%');
        end if;

        -- 条件2：第二匹配字段（AND 匹配）
        v_match2 := true;  -- 默认通过
        if rec.match_field2 is not null and rec.match_value2 is not null and rec.match_value2 != '' then
            if rec.match_field2 = 'counterparty_name' then
                v_match2 := (v_counterparty_name ilike '%' || rec.match_value2 || '%');
            elsif rec.match_field2 = 'summary' then
                v_match2 := (v_summary ilike '%' || rec.match_value2 || '%');
            elsif rec.match_field2 = 'memo' then
                v_match2 := (v_memo ilike '%' || rec.match_value2 || '%');
            elsif rec.match_field2 = 'purpose' then
                v_match2 := (v_purpose ilike '%' || rec.match_value2 || '%');
            end if;
        end if;

        -- 如果两个条件都满足，命中此规则
        if v_match1 and v_match2 then
            v_rule_id := rec.rule_id;
            v_lvl1 := rec.lvl1;
            v_lvl2 := rec.lvl2;
            v_classified_source := 'rule';
            return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
        end if;
    end loop;

    -- Step 3: 未分类
    v_rule_id := null;
    v_lvl1 := '未分类';
    v_lvl2 := null;
    v_classified_source := 'unclassified';
    return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
end;
$$ language plpgsql;

------------------------------------------------------------
-- T3. 冲突检测函数：检查规则是否冲突
-- 用于规则沉淀时检测同一关键词是否被分配给不同分类
------------------------------------------------------------
create or replace function yufeng_cfg.fn_check_rule_conflict(
    p_brand text,
    p_match_field text,
    p_match_value text,
    p_lvl1 text,
    p_lvl2 text
)
returns table (
    conflict_rule_id bigint,
    conflict_lvl1 text,
    conflict_lvl2 text,
    conflict_match_field text,
    conflict_match_value text
) as $$
begin
    return query
    select
        r.rule_id,
        r.lvl1,
        r.lvl2,
        r.match_field,
        r.match_value
    from yufeng_cfg.bank_rule_map r
    where r.enabled = true
      and r.match_field = p_match_field
      and r.match_value = p_match_value
      -- 排除完全相同的分类（允许重复定义相同规则）
      and not (r.lvl1 = p_lvl1 and coalesce(r.lvl2, '') = coalesce(p_lvl2, ''));
end;
$$ language plpgsql;

------------------------------------------------------------
-- T4. 新增收入分类规则（其他收入）
-- 其他收入/注资、借款、利息、退税、退款
------------------------------------------------------------
insert into yufeng_cfg.bank_rule_map
(enabled, priority, match_field, match_type, match_value, direction, lvl1, lvl2, note)
values
-- ============================================================
-- 其他收入（in）- 注资/借款/利息/退税/退款
-- ============================================================
(true, 36, 'any', 'contains', '注资', 'in', '其他收入', '注资', '股东注资/增资（其他收入）'),
(true, 37, 'any', 'contains', '借款', 'in', '其他收入', '借款', '借款人还款/借款转入（其他收入）'),
(true, 38, 'any', 'contains', '利息收入', 'in', '其他收入', '利息', '利息收入'),
(true, 38, 'any', 'contains', '利息', 'in', '其他收入', '利息', '利息收入（简化匹配）'),
(true, 39, 'any', 'contains', '退税', 'in', '其他收入', '退税', '税费退还'),
(true, 40, 'any', 'contains', '退款', 'in', '其他收入', '退款', '退款收入')
on conflict do nothing;

------------------------------------------------------------
-- T5. 规则沉淀函数：创建规则时自动检测冲突
-- 返回：rule_id（成功）或 conflict 提示
------------------------------------------------------------
create or replace function yufeng_cfg.fn_settle_rule(
    p_brand text,
    p_match_field text,
    p_match_value text,
    p_match_field2 text default null,
    p_match_value2 text default null,
    p_direction text,
    p_lvl1 text,
    p_lvl2 text,
    p_priority int default null,
    p_note text default null
)
returns table (
    success boolean,
    rule_id bigint,
    message text,
    conflicts jsonb
) as $$
declare
    v_conflicts jsonb;
    v_new_rule_id bigint;
    v_max_priority int;
begin
    -- 检查冲突（仅针对主条件）
    if p_match_field is not null and p_match_value is not null then
        select jsonb_agg(jsonb_build_object(
            'rule_id', r.rule_id,
            'lvl1', r.lvl1,
            'lvl2', r.lvl2,
            'match_field', r.match_field,
            'match_value', r.match_value
        ))
        into v_conflicts
        from yufeng_cfg.fn_check_rule_conflict(p_brand, p_match_field, p_match_value, p_lvl1, p_lvl2) r;

        if v_conflicts is not null and jsonb_array_length(v_conflicts) > 0 then
            -- 存在冲突，返回冲突信息
            return query select false, null::bigint, 'conflict_detected', v_conflicts;
            return;
        end if;
    end if;

    -- 无冲突，插入新规则
    -- 如果未指定 priority，使用最大 priority + 10
    if p_priority is null then
        select coalesce(max(priority), 0) + 10 into v_max_priority from yufeng_cfg.bank_rule_map;
    else
        v_max_priority := p_priority;
    end if;

    insert into yufeng_cfg.bank_rule_map
    (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1, lvl2, note)
    values
    (true, v_max_priority, p_match_field, 'contains', p_match_value, p_match_field2, p_match_value2, p_direction, p_lvl1, p_lvl2, p_note)
    returning rule_id into v_new_rule_id;

    return query select true, v_new_rule_id, 'rule_created', null::jsonb;
end;
$$ language plpgsql;

------------------------------------------------------------
-- 验证查询
------------------------------------------------------------
-- 1. 查看新增列
-- select column_name, data_type from information_schema.columns
-- where table_name = 'bank_rule_map' and table_schema = 'yufeng_cfg'
-- order by ordinal_position;

-- 2. 查看新增的收入分类规则
-- select * from yufeng_cfg.bank_rule_map where lvl1 = '其他收入';

-- 3. 测试冲突检测函数
-- select * from yufeng_cfg.fn_check_rule_conflict('yufeng', 'summary', '美团', '营业收入', '美团');
