-- Yufeng｜门店维表（用于下拉筛选显示“门店名”）

create schema if not exists yufeng_cfg;

create table if not exists yufeng_cfg.dim_store (
  store_code text primary key,
  store_name text not null
);

-- seed（可按需扩展）
insert into yufeng_cfg.dim_store(store_code, store_name)
values
  ('yf_gh', '榆枫国华')
on conflict (store_code) do update
set store_name = excluded.store_name;
