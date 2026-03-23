-- Bonjur｜CFG DDL（一期：银行流水关键词分类规则）
-- 说明：当前 Bonjur 可能尚未接入 bank_txn，但先把规则表结构准备好，便于 UI 复用。

create schema if not exists bonjur_cfg;

create table if not exists bonjur_cfg.bank_rule_map (
  rule_id      bigserial primary key,
  enabled      boolean not null default true,
  priority     int not null,

  match_field  text not null,   -- counterparty_name | summary | memo | purpose | any
  match_type   text not null,   -- contains | regex
  match_value  text not null,

  -- 支持双重匹配（AND），与 yufeng_cfg 对齐
  match_field2 text,
  match_value2 text,

  direction    text not null default 'any', -- in | out | any

  lvl1         text not null,
  lvl2         text,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_bonjur_bank_rule_enabled_priority on bonjur_cfg.bank_rule_map(enabled, priority);
create index if not exists idx_bonjur_bank_rule_lvl1 on bonjur_cfg.bank_rule_map(lvl1);
