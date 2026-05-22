-- Yufeng｜ODS DDL（一期，银行流水明细）
-- 说明：方案B（同库分品牌schema），本文件仅包含 Yufeng 品牌的 ODS 最小表结构。

create schema if not exists yufeng_ods;

create table if not exists yufeng_ods.bank_txn (
  id               bigserial primary key,
  store_code        text not null default 'yf_gh',
  self_acct         text,

  txn_time          timestamptz,
  counterparty_name text,
  counterparty_acct text,

  in_amt            numeric(14,2),
  out_amt           numeric(14,2),
  balance_amt       numeric(14,2),

  summary           text,
  purpose           text,
  memo              text,

  source_file_id    bigint,
  created_at        timestamptz not null default now()
);

create index if not exists idx_bank_txn_time on yufeng_ods.bank_txn(txn_time);
create index if not exists idx_bank_txn_store_time on yufeng_ods.bank_txn(store_code, txn_time);
create index if not exists idx_bank_txn_counterparty on yufeng_ods.bank_txn(counterparty_name);
