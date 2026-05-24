-- Yufeng｜OPS DDL - 未分类流水人工处理日志
-- 用途：审计用，记录每笔未分类流水的处理历史（不参与分类，仅供追溯）
-- 注意：该表不参与分类逻辑，仅用于审计

create schema if not exists yufeng_ops;

create table if not exists yufeng_ops.unclassified_resolution_log (
  log_id            bigserial primary key,
  bank_txn_id       bigint not null,
  month             text not null,

  -- 处理的分类结果
  direction         text not null,        -- in | out
  lvl1_code         text not null,
  lvl2_code         text,
  match_field       text not null,       -- summary | memo | purpose | counterparty_name
  match_value       text not null,
  priority          int not null default 1000,
  enabled           boolean not null default true,

  -- 元数据
  action_type       text not null,       -- manual_resolve | batch_resolve
  source_ui         text not null default 'match_page',  -- match_page | rules_page | batch_import
  resolution_mode   text not null,       -- override | rule_deposit

  -- 原始流水快照（便于审计）
  original_summary      text,
  original_memo        text,
  original_purpose     text,
  original_counterparty text,
  original_in_amt       numeric(18,4),
  original_out_amt      numeric(18,4),

  -- 操作人/时间
  created_by        text not null default 'ui',
  created_at        timestamptz not null default now()
);

-- 审计索引
create index if not exists idx_yufeng_unclassified_log_txn on yufeng_ops.unclassified_resolution_log(bank_txn_id);
create index if not exists idx_yufeng_unclassified_log_month on yufeng_ops.unclassified_resolution_log(month);
create index if not exists idx_yufeng_unclassified_log_lvl1 on yufeng_ops.unclassified_resolution_log(lvl1_code);
create index if not exists idx_yufeng_unclassified_log_created on yufeng_ops.unclassified_resolution_log(created_at);
