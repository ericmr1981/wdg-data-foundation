-- Bonjur｜按上传文件维度的覆盖率统计
-- 用途：按 source_file_id（每次上传文件）维度统计覆盖率，而非按月
-- 依赖：raw.ingest_file, bonjur_ods.bank_txn, bonjur_dm.v_bank_txn_classified

------------------------------------------------------------
-- 按文件维度覆盖率统计视图
------------------------------------------------------------
drop view if exists bonjur_dm.v_coverage_by_file;

create view bonjur_dm.v_coverage_by_file as
select
    -- 文件元数据
    f.id as source_file_id,
    f.file_name,
    f.file_path,
    f.store_code,
    date_trunc('month', min(t.txn_time))::date as file_month,

    -- 笔数
    coalesce(sub.total_rows, 0) as total_rows,
    coalesce(sub.covered_rows, 0) as covered_rows,
    coalesce(sub.unclassified_rows, 0) as unclassified_rows,
    round(coalesce(sub.covered_rows * 100.0 / nullif(sub.total_rows, 0), 0), 2) as coverage_rate_rows,

    -- in_amt
    coalesce(sub.total_in_amt, 0) as total_in_amt,
    coalesce(sub.covered_in_amt, 0) as covered_in_amt,
    coalesce(sub.unclassified_in_amt, 0) as unclassified_in_amt,
    round(coalesce(sub.covered_in_amt * 100.0 / nullif(sub.total_in_amt, 0), 0), 2) as coverage_rate_in_amt,

    -- out_amt
    coalesce(sub.total_out_amt, 0) as total_out_amt,
    coalesce(sub.covered_out_amt, 0) as covered_out_amt,
    coalesce(sub.unclassified_out_amt, 0) as unclassified_out_amt,
    round(coalesce(sub.covered_out_amt * 100.0 / nullif(sub.total_out_amt, 0), 0), 2) as coverage_rate_out_amt,

    -- 时间信息
    f.created_at as uploaded_at,
    f.status as import_status

from raw.ingest_file f
left join bonjur_ods.bank_txn t on t.source_file_id = f.id
left join (
    select
        t.source_file_id,

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
    where t.source_file_id is not null
    group by t.source_file_id
) sub on f.id = sub.source_file_id

where f.brand_code = 'bonjur'
  and f.source_type = 'bank'
  and f.status = 'success'

group by f.id, f.file_name, f.file_path, f.store_code, f.created_at, f.status,
         sub.total_rows, sub.covered_rows, sub.unclassified_rows,
         sub.total_in_amt, sub.covered_in_amt, sub.unclassified_in_amt,
         sub.total_out_amt, sub.covered_out_amt, sub.unclassified_out_amt

order by f.created_at desc;

------------------------------------------------------------
-- 按文件维度的未分类 TopN 视图
------------------------------------------------------------
drop view if exists bonjur_dm.v_unclassified_top_by_file;

create view bonjur_dm.v_unclassified_top_by_file as
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

from bonjur_ods.bank_txn t
inner join bonjur_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
inner join raw.ingest_file f on t.source_file_id = f.id
where c.classified_source = 'unclassified'
  and f.brand_code = 'bonjur'

group by t.source_file_id, f.file_name, date_trunc('month', t.txn_time)::date, t.counterparty_name, t.summary, t.memo
order by t.source_file_id desc, txn_rows desc, total_amt desc;

------------------------------------------------------------
-- 验证查询示例
------------------------------------------------------------
-- select * from bonjur_dm.v_coverage_by_file limit 10;
-- select * from bonjur_dm.v_unclassified_top_by_file limit 50;
