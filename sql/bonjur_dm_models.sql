-- Bonjur｜DM 模型（三张主表，参考 Yufeng 结构）
-- 说明：Bonjur 一期只有营业数据（bonjur_ods.sales_monthly），暂无银行流水/费用分类。
-- 策略：先把 DM 视图结构搭起来：
--   - revenue_monthly：业务口径有值；银行口径留 NULL
--   - expense_monthly：先返回 0 行（结构就绪，后续接入 bonjur_ods.bank_txn 后补）
--   - profit_monthly：先只给 biz_revenue_amt，其余留 NULL

------------------------------------------------------------
-- revenue_monthly
------------------------------------------------------------
drop view if exists bonjur_dm.revenue_monthly;

create view bonjur_dm.revenue_monthly as
select
  sm.month as month,
  coalesce(sum(sm.revenue_amt), 0) as biz_revenue_amt,
  null::numeric as bank_revenue_amt,
  null::numeric as diff_amt
from bonjur_ods.sales_monthly sm
where sm.month is not null
group by sm.month
order by sm.month desc;

------------------------------------------------------------
-- expense_monthly（占位：0 行，但字段对齐 yufeng_dm.expense_monthly）
------------------------------------------------------------
drop view if exists bonjur_dm.expense_monthly;

create view bonjur_dm.expense_monthly as
select
  null::date as month,
  null::text as lvl1,
  null::text as lvl2,
  null::numeric as total_out_amt,
  null::bigint as txn_rows
where false;

------------------------------------------------------------
-- profit_monthly
------------------------------------------------------------
drop view if exists bonjur_dm.profit_monthly;

create view bonjur_dm.profit_monthly as
select
  sm.month as month,

  -- 银行口径（暂缺）
  null::numeric as bank_revenue_amt,
  null::numeric as total_expense_amt,
  null::numeric as profit_amt,

  -- 业务口径（来自营业数据）
  coalesce(sum(sm.revenue_amt), 0) as biz_revenue_amt,

  -- 差异（暂缺）
  null::numeric as diff_amt

from bonjur_ods.sales_monthly sm
where sm.month is not null
group by sm.month
order by sm.month desc;
