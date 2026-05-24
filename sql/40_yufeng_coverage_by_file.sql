-- Yufeng｜T8.5 按上传文件维度的覆盖率统计
-- 用途：按 source_file_id（每次上传文件）维度统计覆盖率，而非按月
-- 依赖：raw.ingest_file, yufeng_ods.bank_txn, yufeng_dm.v_bank_txn_classified
-- 创建时间：2026-03-22

------------------------------------------------------------
-- T8.5.1 按文件维度覆盖率统计视图
-- 说明：
--   - 1 个 ingest_file.id = 1 个文件（source_file_id）
--   - 支持多文件上传，每个文件各自一个 id
--   - 输出：该文件的覆盖率统计 + 文件元数据
------------------------------------------------------------
drop view if exists yufeng_dm.v_coverage_by_file;

create view yufeng_dm.v_coverage_by_file as
select
    -- 文件元数据
    f.id as source_file_id,
    f.file_name,
    f.file_path,
    f.store_code,
    -- 文件月份从交易时间推导（不再使用 ingest_file.month）
    date_trunc('month', min(t.txn_time))::date as file_month,

    -- 笔数统计
    coalesce(sub.total_rows, 0) as total_rows,
    coalesce(sub.covered_rows, 0) as covered_rows,
    coalesce(sub.unclassified_rows, 0) as unclassified_rows,
    round(coalesce(sub.covered_rows * 100.0 / nullif(sub.total_rows, 0), 0), 2) as coverage_rate_rows,

    -- 转入金额统计（in_amt）
    coalesce(sub.total_in_amt, 0) as total_in_amt,
    coalesce(sub.covered_in_amt, 0) as covered_in_amt,
    coalesce(sub.unclassified_in_amt, 0) as unclassified_in_amt,
    round(coalesce(sub.covered_in_amt * 100.0 / nullif(sub.total_in_amt, 0), 0), 2) as coverage_rate_in_amt,

    -- 转出金额统计（out_amt）
    coalesce(sub.total_out_amt, 0) as total_out_amt,
    coalesce(sub.covered_out_amt, 0) as covered_out_amt,
    coalesce(sub.unclassified_out_amt, 0) as unclassified_out_amt,
    round(coalesce(sub.covered_out_amt * 100.0 / nullif(sub.total_out_amt, 0), 0), 2) as coverage_rate_out_amt,

    -- 时间信息
    f.created_at as uploaded_at,
    f.status as import_status

from raw.ingest_file f
left join yufeng_ods.bank_txn t on t.source_file_id = f.id
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

    from yufeng_ods.bank_txn t
    left join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
    where t.source_file_id is not null
    group by t.source_file_id
) sub on f.id = sub.source_file_id

where f.brand_code = 'yufeng'
  and f.source_type = 'bank'
  and f.status = 'success'

group by f.id, f.file_name, f.file_path, f.store_code, f.created_at, f.status, sub.total_rows, sub.covered_rows, sub.unclassified_rows, sub.total_in_amt, sub.covered_in_amt, sub.unclassified_in_amt, sub.total_out_amt, sub.covered_out_amt, sub.unclassified_out_amt

order by f.created_at desc;

------------------------------------------------------------
-- T8.5.2 按文件维度的未分类 TopN 视图
-- 用途：查看每个文件的未分类流水 TopN，便于针对性补规则
------------------------------------------------------------
drop view if exists yufeng_dm.v_unclassified_top_by_file;

create view yufeng_dm.v_unclassified_top_by_file as
select
    t.source_file_id,
    f.file_name,
    date_trunc('month', t.txn_time)::date as month,
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
inner join raw.ingest_file f on t.source_file_id = f.id
where c.classified_source = 'unclassified'
  and f.brand_code = 'yufeng'

group by t.source_file_id, f.file_name, date_trunc('month', t.txn_time)::date, t.counterparty_name, t.summary, t.memo
order by t.source_file_id desc, txn_rows desc, total_amt desc;

------------------------------------------------------------
-- 验证查询示例
------------------------------------------------------------

-- T8.5.1 按文件维度覆盖率（最近10个文件）
-- select * from yufeng_dm.v_coverage_by_file limit 10;

-- T8.5.1 特定文件的覆盖率详情
-- select * from yufeng_dm.v_coverage_by_file where source_file_id = :file_id;

-- T8.5.2 特定文件的未分类 TopN
-- select * from yufeng_dm.v_unclassified_top_by_file where source_file_id = :file_id limit 20;

-- T8.5.2 所有文件的未分类汇总 TopN
-- select * from yufeng_dm.v_unclassified_top_by_file limit 50;
