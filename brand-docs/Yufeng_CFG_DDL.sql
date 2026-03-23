-- Yufeng｜CFG DDL（一期：银行流水关键词分类规则）

create schema if not exists yufeng_cfg;

-- 关键词规则表：用于把 bank_txn 归类到 lvl1/lvl2
create table if not exists yufeng_cfg.bank_rule_map (
  rule_id      bigserial primary key,
  enabled      boolean not null default true,
  priority     int not null,

  match_field  text not null,   -- counterparty_name | summary | memo | purpose | any
  match_type   text not null,   -- contains | regex
  match_value  text not null,

  direction    text not null default 'any', -- in | out | any

  lvl1         text not null,
  lvl2         text,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_bank_rule_enabled_priority on yufeng_cfg.bank_rule_map(enabled, priority);
create index if not exists idx_bank_rule_lvl1 on yufeng_cfg.bank_rule_map(lvl1);
