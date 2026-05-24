-- ============================================================
-- gelatomiiix 未分类 & 覆盖率视图
-- 基于 yufeng_coverage_and_unclassified.sql + coverage_by_file.sql
-- 将 yufeng/bonjur 的视图模式移植到 brand_gelatomiiix 命名空间
-- ============================================================

-- === v_unclassified_top ===
drop view if exists brand_gelatomiiix_dm.v_unclassified_top cascade;

create view brand_gelatomiiix_dm.v_unclassified_top as
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
from brand_gelatomiiix_ods.bank_txn t
inner join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where c.classified_source = 'unclassified'
group by date_trunc('month', t.txn_time)::date, t.counterparty_name, t.summary, t.memo
order by month desc, txn_rows desc, total_amt desc;

-- === v_unclassified_detail ===
drop view if exists brand_gelatomiiix_dm.v_unclassified_detail cascade;

create view brand_gelatomiiix_dm.v_unclassified_detail as
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
from brand_gelatomiiix_ods.bank_txn t
inner join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
where c.classified_source = 'unclassified'
order by month desc, t.txn_time desc;

-- === v_coverage_monthly ===
drop view if exists brand_gelatomiiix_dm.v_coverage_monthly cascade;

create view brand_gelatomiiix_dm.v_coverage_monthly as
with monthly_stats as (
    select
        date_trunc('month', t.txn_time)::date as month,
        count(*) as total_rows,
        count(*) filter (where c.classified_source in ('rule', 'override')) as covered_rows,
        count(*) filter (where c.classified_source = 'unclassified') as unclassified_rows,
        coalesce(sum(t.in_amt), 0) as total_in_amt,
        coalesce(sum(t.in_amt) filter (where c.classified_source in ('rule', 'override')), 0) as covered_in_amt,
        coalesce(sum(t.in_amt) filter (where c.classified_source = 'unclassified'), 0) as unclassified_in_amt,
        coalesce(sum(t.out_amt), 0) as total_out_amt,
        coalesce(sum(t.out_amt) filter (where c.classified_source in ('rule', 'override')), 0) as covered_out_amt,
        coalesce(sum(t.out_amt) filter (where c.classified_source = 'unclassified'), 0) as unclassified_out_amt
    from brand_gelatomiiix_ods.bank_txn t
    inner join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    group by date_trunc('month', t.txn_time)::date
)
select
    month,
    total_rows,
    covered_rows,
    unclassified_rows,
    case when total_rows > 0 then round(covered_rows * 100.0 / total_rows, 2) else 0 end as coverage_rate_rows,
    total_in_amt,
    covered_in_amt,
    unclassified_in_amt,
    case when total_in_amt > 0 then round(covered_in_amt * 100.0 / total_in_amt, 2) else 0 end as coverage_rate_in_amt,
    total_out_amt,
    covered_out_amt,
    unclassified_out_amt,
    case when total_out_amt > 0 then round(covered_out_amt * 100.0 / total_out_amt, 2) else 0 end as coverage_rate_out_amt
from monthly_stats
order by month desc;

-- === v_unclassified_top_by_file ===
drop view if exists brand_gelatomiiix_dm.v_unclassified_top_by_file cascade;

create view brand_gelatomiiix_dm.v_unclassified_top_by_file as
select
    t.source_file_id,
    f.file_name,
    date_trunc('month', t.txn_time)::date as month,
    t.counterparty_name,
    t.summary,
    t.memo,
    coalesce(t.counterparty_name, '') || ' | ' || coalesce(t.summary, '') || ' | ' || coalesce(t.memo, '') as combined_text,
    count(*) as txn_rows,
    coalesce(sum(coalesce(t.in_amt, 0)), 0) as in_amt,
    coalesce(sum(coalesce(t.out_amt, 0)), 0) as out_amt,
    coalesce(sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0)), 0) as total_amt
from brand_gelatomiiix_ods.bank_txn t
inner join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
inner join raw.ingest_file f on t.source_file_id = f.id
where c.classified_source = 'unclassified'
  and f.brand_code = 'gelatomiiix'
group by t.source_file_id, f.file_name, date_trunc('month', t.txn_time)::date, t.counterparty_name, t.summary, t.memo
order by t.source_file_id desc, txn_rows desc, total_amt desc;

-- === v_coverage_by_file ===
drop view if exists brand_gelatomiiix_dm.v_coverage_by_file cascade;

create view brand_gelatomiiix_dm.v_coverage_by_file as
with file_stats as (
    select
        t.source_file_id,
        f.file_name,
        f.file_path,
        f.store_code,
        f.month as file_month,
        count(*) as total_rows,
        count(*) filter (where c.classified_source in ('rule', 'override')) as covered_rows,
        count(*) filter (where c.classified_source = 'unclassified') as unclassified_rows,
        coalesce(sum(t.in_amt), 0) as total_in_amt,
        coalesce(sum(t.in_amt) filter (where c.classified_source in ('rule', 'override')), 0) as covered_in_amt,
        coalesce(sum(t.in_amt) filter (where c.classified_source = 'unclassified'), 0) as unclassified_in_amt,
        coalesce(sum(t.out_amt), 0) as total_out_amt,
        coalesce(sum(t.out_amt) filter (where c.classified_source in ('rule', 'override')), 0) as covered_out_amt,
        coalesce(sum(t.out_amt) filter (where c.classified_source = 'unclassified'), 0) as unclassified_out_amt,
        f.updated_at as uploaded_at,
        f.status as import_status
    from brand_gelatomiiix_ods.bank_txn t
    inner join brand_gelatomiiix_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    inner join raw.ingest_file f on t.source_file_id = f.id
    where f.brand_code = 'gelatomiiix'
    group by t.source_file_id, f.file_name, f.file_path, f.store_code, f.month, f.updated_at, f.status
)
select
    source_file_id,
    file_name,
    file_path,
    store_code,
    file_month,
    total_rows,
    covered_rows,
    unclassified_rows,
    case when total_rows > 0 then round(covered_rows * 100.0 / total_rows, 2) else 0 end as coverage_rate_rows,
    total_in_amt,
    covered_in_amt,
    unclassified_in_amt,
    case when total_in_amt > 0 then round(covered_in_amt * 100.0 / total_in_amt, 2) else 0 end as coverage_rate_in_amt,
    total_out_amt,
    covered_out_amt,
    unclassified_out_amt,
    case when total_out_amt > 0 then round(covered_out_amt * 100.0 / total_out_amt, 2) else 0 end as coverage_rate_out_amt,
    uploaded_at,
    import_status
from file_stats
order by source_file_id desc;
