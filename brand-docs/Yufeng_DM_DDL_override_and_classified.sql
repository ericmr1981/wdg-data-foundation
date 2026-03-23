-- Yufeng｜DM DDL：override 表与 classified 视图
-- 用途：人工兜底 override + 规则匹配 classified 结果
-- 依赖：yufeng_ods.bank_txn, yufeng_cfg.bank_rule_map

------------------------------------------------------------
-- T4.2 人工匹配覆盖表（override）
------------------------------------------------------------
create schema if not exists yufeng_dm;

-- 人工 override 表：存储人工分类兜底结果
-- 优先级：override > rule > 未分类
create table if not exists yufeng_dm.bank_txn_override (
    id              bigserial primary key,
    bank_txn_id     bigint not null unique,  -- FK -> yufeng_ods.bank_txn.id

    lvl1            text not null,
    lvl2            text,
    note            text,

    created_by      text not null default 'ui',  -- 默认 'ui'（无需登录）
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- 索引：加速查询
create index if not exists idx_override_bank_txn_id on yufeng_dm.bank_txn_override(bank_txn_id);
create index if not exists idx_override_lvl1 on yufeng_dm.bank_txn_override(lvl1);

------------------------------------------------------------
-- T2.4 规则命中计算视图（classified）
-- 优先级：override > rule > unclassified
-- 输出字段：bank_txn_id, txn_time, counterparty_name/summary/memo/purpose,
--           in_amt/out_amt, lvl1, lvl2, matched_rule_id, classified_source
------------------------------------------------------------

-- 确保 classify_result type 存在（用于函数返回类型）
DROP TYPE IF EXISTS yufeng_dm.classify_result CASCADE;
CREATE TYPE yufeng_dm.classify_result AS (
    matched_rule_id bigint,
    lvl1 text,
    lvl2 text,
    classified_source text
);

-- 1) 先删除已存在的函数，确保幂等（解决 "cannot change return type" 错误）
DROP FUNCTION IF EXISTS yufeng_dm.fn_classify_bank_txn(bigint) CASCADE;

-- 2) 创建一个函数：规则匹配计算
-- 返回：matched_rule_id, lvl1, lvl2, classified_source
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
    for rec in (
        select r.rule_id, r.lvl1, r.lvl2, r.priority
        from yufeng_cfg.bank_rule_map r
        where r.enabled = true
          and (
            (r.direction = 'any')
            or (r.direction = 'in' and v_in_amt is not null and v_in_amt > 0)
            or (r.direction = 'out' and v_out_amt is not null and v_out_amt > 0)
          )
          and (
            (r.match_field = 'any' and (
                v_counterparty_name ilike '%' || r.match_value || '%'
                or v_summary ilike '%' || r.match_value || '%'
                or v_memo ilike '%' || r.match_value || '%'
                or v_purpose ilike '%' || r.match_value || '%'
            ))
            or (r.match_field = 'counterparty_name' and v_counterparty_name ilike '%' || r.match_value || '%')
            or (r.match_field = 'summary' and v_summary ilike '%' || r.match_value || '%')
            or (r.match_field = 'memo' and v_memo ilike '%' || r.match_value || '%')
            or (r.match_field = 'purpose' and v_purpose ilike '%' || r.match_value || '%')
          )
        order by r.priority asc
        limit 1
    ) loop
        v_rule_id := rec.rule_id;
        v_lvl1 := rec.lvl1;
        v_lvl2 := rec.lvl2;
        v_classified_source := 'rule';
        return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
    end loop;

    -- Step 3: 未分类
    v_rule_id := null;
    v_lvl1 := '未分类';
    v_lvl2 := null;
    v_classified_source := 'unclassified';
    return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
end;
$$ language plpgsql;


-- 2) 创建 classified 视图：整合 override + rule + unclassified 结果
create or replace view yufeng_dm.v_bank_txn_classified as
select
    t.id as bank_txn_id,
    t.store_code,
    t.txn_time,
    t.counterparty_name,
    t.summary,
    t.memo,
    t.purpose,
    t.in_amt,
    t.out_amt,

    -- 分类结果（来自函数计算）
    (yufeng_dm.fn_classify_bank_txn(t.id)).matched_rule_id as matched_rule_id,
    (yufeng_dm.fn_classify_bank_txn(t.id)).lvl1 as lvl1,
    (yufeng_dm.fn_classify_bank_txn(t.id)).lvl2 as lvl2,
    (yufeng_dm.fn_classify_bank_txn(t.id)).classified_source as classified_source,

    -- 额外信息
    t.source_file_id
from yufeng_ods.bank_txn t;


------------------------------------------------------------
-- 覆盖写回函数（UI 调用）
-- 说明：UI 保存时调用此函数写入 override 表
------------------------------------------------------------
create or replace function yufeng_dm.upsert_bank_txn_override(
    p_bank_txn_id bigint,
    p_lvl1 text,
    p_lvl2 text,
    p_note text,
    p_created_by text default 'ui'
)
returns void as $$
begin
    insert into yufeng_dm.bank_txn_override (bank_txn_id, lvl1, lvl2, note, created_by)
    values (p_bank_txn_id, p_lvl1, p_lvl2, p_note, p_created_by)
    on conflict (bank_txn_id) do update set
        lvl1 = excluded.lvl1,
        lvl2 = excluded.lvl2,
        note = excluded.note,
        updated_at = now();
end;
$$ language plpgsql;


------------------------------------------------------------
-- 覆盖删除函数（UI 调用）
-- 说明：删除 override，恢复为规则匹配/未分类
------------------------------------------------------------
create or replace function yufeng_dm.delete_bank_txn_override(p_bank_txn_id bigint)
returns void as $$
begin
    delete from yufeng_dm.bank_txn_override where bank_txn_id = p_bank_txn_id;
end;
$$ language plpgsql;
