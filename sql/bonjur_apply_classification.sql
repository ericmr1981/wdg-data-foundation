-- Bonjur｜分类规则应用（override + classified）
-- 用途：与 yufeng_dm 对齐的“规则分类 + 人工覆盖”能力
-- 依赖：bonjur_ods.bank_txn, bonjur_cfg.bank_rule_map

------------------------------------------------------------
-- 人工匹配覆盖表（override）
------------------------------------------------------------
create schema if not exists bonjur_dm;

create table if not exists bonjur_dm.bank_txn_override (
    id              bigserial primary key,
    bank_txn_id     bigint not null unique,  -- FK -> bonjur_ods.bank_txn.id

    lvl1            text not null,
    lvl2            text,
    note            text,

    created_by      text not null default 'ui',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_bonjur_override_bank_txn_id on bonjur_dm.bank_txn_override(bank_txn_id);
create index if not exists idx_bonjur_override_lvl1 on bonjur_dm.bank_txn_override(lvl1);

------------------------------------------------------------
-- 规则命中计算（classified）
-- 优先级：override > rule > unclassified
------------------------------------------------------------

-- 返回类型（用于函数返回，便于 UI/视图消费）
DROP TYPE IF EXISTS bonjur_dm.classify_result CASCADE;
CREATE TYPE bonjur_dm.classify_result AS (
    matched_rule_id bigint,
    lvl1 text,
    lvl2 text,
    classified_source text
);

-- 幂等：避免 return type 变更导致的报错
DROP FUNCTION IF EXISTS bonjur_dm.fn_classify_bank_txn(bigint) CASCADE;

create or replace function bonjur_dm.fn_classify_bank_txn(p_bank_txn_id bigint)
returns bonjur_dm.classify_result as $$
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
    from bonjur_ods.bank_txn t
    where t.id = p_bank_txn_id;

    -- Step 1: override（优先级最高）
    select o.lvl1, o.lvl2, o.bank_txn_id
    into v_lvl1, v_lvl2, v_rule_id
    from bonjur_dm.bank_txn_override o
    where o.bank_txn_id = p_bank_txn_id;

    if found then
        v_classified_source := 'override';
        return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
    end if;

    -- Step 2: 规则匹配（first-match by priority）
    for rec in (
        select r.rule_id, r.lvl1, r.lvl2, r.priority
        from bonjur_cfg.bank_rule_map r
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

create or replace view bonjur_dm.v_bank_txn_classified as
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

    (bonjur_dm.fn_classify_bank_txn(t.id)).matched_rule_id as matched_rule_id,
    (bonjur_dm.fn_classify_bank_txn(t.id)).lvl1 as lvl1,
    (bonjur_dm.fn_classify_bank_txn(t.id)).lvl2 as lvl2,
    (bonjur_dm.fn_classify_bank_txn(t.id)).classified_source as classified_source,

    t.source_file_id
from bonjur_ods.bank_txn t;

------------------------------------------------------------
-- 覆盖写回函数（UI 调用）
------------------------------------------------------------
create or replace function bonjur_dm.upsert_bank_txn_override(
    p_bank_txn_id bigint,
    p_lvl1 text,
    p_lvl2 text,
    p_note text,
    p_created_by text default 'ui'
)
returns void as $$
begin
    insert into bonjur_dm.bank_txn_override (bank_txn_id, lvl1, lvl2, note, created_by)
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
------------------------------------------------------------
create or replace function bonjur_dm.delete_bank_txn_override(p_bank_txn_id bigint)
returns void as $$
begin
    delete from bonjur_dm.bank_txn_override where bank_txn_id = p_bank_txn_id;
end;
$$ language plpgsql;
