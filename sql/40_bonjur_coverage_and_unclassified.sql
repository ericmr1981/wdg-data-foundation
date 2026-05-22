drop view if exists bonjur_dm.v_unclassified_detail cascade;
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

drop view if exists bonjur_dm.v_unclassified_top cascade;
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
