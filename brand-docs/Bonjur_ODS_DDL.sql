-- Bonjur｜ODS DDL（一期，月粒度）
-- 说明：方案B（同库分品牌schema），本文件仅包含 Bonjur 品牌的 ODS 最小表结构。

create schema if not exists bonjur_ods;

-- 营业月汇总（来自营业数据报告 CSV/Excel）
create table if not exists bonjur_ods.sales_monthly (
  id               bigserial primary key,
  store_code       text not null,
  store_name       text,
  month            date not null,              -- 规则：YYYY-MM → YYYY-MM-01

  gross_sales_amt  numeric(14,2),              -- 营业额
  discount_amt     numeric(14,2),              -- 优惠总额
  revenue_amt      numeric(14,2),              -- 营业收入
  order_cnt        int,                        -- 有效订单数
  refund_amt       numeric(14,2),              -- 退款金额

  source_file_id   bigint,
  created_at       timestamptz not null default now(),

  constraint uq_sales_monthly unique (store_code, month)
);

-- 常用索引
create index if not exists idx_sales_monthly_month on bonjur_ods.sales_monthly(month);
create index if not exists idx_sales_monthly_store on bonjur_ods.sales_monthly(store_code);

------------------------------------------------------------
-- 银行流水（Bonjur）
-- 说明：结构与 yufeng_ods.bank_txn 对齐，便于复用规则 UI/分类逻辑
------------------------------------------------------------
create table if not exists bonjur_ods.bank_txn (
  id               bigserial primary key,
  store_code        text not null,
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

create index if not exists idx_bonjur_bank_txn_time on bonjur_ods.bank_txn(txn_time);
create index if not exists idx_bonjur_bank_txn_store_time on bonjur_ods.bank_txn(store_code, txn_time);
create index if not exists idx_bonjur_bank_txn_counterparty on bonjur_ods.bank_txn(counterparty_name);
