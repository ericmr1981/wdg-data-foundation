-- Bonjur｜门店维表（用于下拉筛选显示“门店名”）

create schema if not exists bonjur_cfg;

create table if not exists bonjur_cfg.dim_store (
  store_code text primary key,
  store_name text not null
);

-- seed（可按需扩展）
insert into bonjur_cfg.dim_store(store_code, store_name)
values
  ('wz_oh_wxc', '温州瓯海万象城店'),
  ('wz_ra_wy',  '温州瑞安吾悦广场店'),
  ('hz_in77',   '杭州in77')
on conflict (store_code) do update
set store_name = excluded.store_name;
