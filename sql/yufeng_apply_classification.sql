-- Yufeng｜一键落库 SQL
-- 用途：T2.2/T2.3 规则表建表 + 初版规则入库 + DM DDL
-- 说明：按顺序执行即可完成落库（本文件不要求真的连库执行，SQL 可独立运行）

------------------------------------------------------------
-- 依赖表结构（ODS - 银行流水）
------------------------------------------------------------
create schema if not exists yufeng_ods;

-- 银行流水表（如果不存在则创建）
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

------------------------------------------------------------
-- T2.2 规则表建表（CFG）
------------------------------------------------------------
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

------------------------------------------------------------
-- T2.3 初版规则入库
-- 目标：覆盖 营业收入渠道、手续费、税金、材料采购、管理费用、往来/借款/注资/还款
-- 说明：first-match wins；priority 越小优先级越高。
-- 幂等策略：仅当规则表为空时才进行 seed（避免 init 重复插入导致膨胀/重复）
------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM yufeng_cfg.bank_rule_map LIMIT 1) THEN
    insert into yufeng_cfg.bank_rule_map
(enabled, priority, match_field, match_type, match_value, direction, lvl1, lvl2, note)
values
-- ============================================================
-- 营业收入（in）- 渠道/平台（优先级 10-19）
-- ============================================================
(true, 10,  'any', 'contains', '美团',   'in',  '营业收入', '美团',   '美团相关回款（附言/摘要含美团）'),
(true, 11,  'any', 'contains', '饿了么', 'in',  '营业收入', '饿了么', '饿了么相关回款'),
(true, 12,  'any', 'contains', '抖音',   'in',  '营业收入', '抖音',   '抖音相关回款'),
(true, 13,  'any', 'contains', '京东',   'in',  '营业收入', '京东',   '京东相关回款'),
(true, 14,  'any', 'contains', '微信',   'in',  '营业收入', '微信',   '微信相关回款'),
(true, 15,  'any', 'contains', '支付宝', 'in',  '营业收入', '支付宝', '支付宝相关回款'),

-- 营业收入（in）- 支付/结算公司关键词（优先级 20-29）
(true, 20,  'any', 'contains', '北京钱袋宝支付技术有限公司', 'in', '营业收入', '美团',     '钱袋宝（常见于美团结算）'),
(true, 21,  'any', 'contains', '浙江网商银行',               'in', '营业收入', '饿了么',   '网商银行（常见于饿了么结算）'),
(true, 22,  'any', 'contains', '上海富友支付服务股份有限公司','in', '营业收入', '其他渠道', '富友（商户结算）'),
(true, 23,  'any', 'contains', '财付通',                     'in', '营业收入', '微信',     '财付通/微信侧结算'),
(true, 24,  'any', 'contains', '支付宝（中国）网络技术有限公司','in', '营业收入', '支付宝',  '支付宝结算'),
(true, 25,  'any', 'contains', '通联支付',                   'in', '营业收入', '其他渠道', '通联支付结算'),

-- ============================================================
-- 往来/借款/注资（in）- 优先级 30-39
-- ============================================================
(true, 30,  'any', 'contains', '借款',   'in',  '往来/借款', '借款',    '借款人还款/借款转入'),
(true, 31,  'any', 'contains', '注资',   'in',  '往来/注资', '注资',    '股东注资/增资'),
(true, 32,  'any', 'contains', '投资',   'in',  '往来/注资', '投资',    '投资收益/投资款'),
(true, 33,  'any', 'contains', '还款',   'in',  '往来/还款', '还款',    '收到还款'),
(true, 34,  'any', 'contains', '往来',   'in',  '往来/其他', '往来',    '往来款'),
(true, 35,  'any', 'contains', '暂借款',  'in',  '往来/借款', '暂借款',  '暂借款收回'),

-- ============================================================
-- 手续费（out）- 优先级 110-119
-- ============================================================
(true, 110, 'any', 'contains', '手续费', 'out', '手续费', null,       '银行/通道手续费'),
(true, 111, 'any', 'contains', '服务费', 'out', '手续费', '服务费',   '各类服务费'),
(true, 112, 'any', 'contains', '扣费',   'out', '手续费', null,       '扣费'),

-- ============================================================
-- 税金（out）- 优先级 120-129
-- ============================================================
(true, 120, 'any', 'contains', '增值税',   'out', '税金', '增值税',   '增值税扣款'),
(true, 121, 'any', 'contains', '所得税',   'out', '税金', '所得税',   '所得税扣款'),
(true, 122, 'any', 'contains', '印花税',   'out', '税金', '印花税',   '印花税'),
(true, 123, 'any', 'contains', '附加税',   'out', '税金', '附加税',   '城建税/教育费附加'),
(true, 124, 'any', 'contains', '税务',     'out', '税金', '其他税金', '其他税务扣款'),

-- ============================================================
-- 材料采购/货款/物料（out）- 优先级 200-209
-- ============================================================
(true, 200, 'any', 'contains', '材料',     'out', '材料采购', '材料',   '材料采购款'),
(true, 201, 'any', 'contains', '采购',     'out', '材料采购', '采购',   '采购款'),
(true, 202, 'any', 'contains', '货款',     'out', '材料采购', '货款',   '货款'),
(true, 203, 'any', 'contains', '物料',     'out', '材料采购', '物料',   '物料采购'),
(true, 204, 'any', 'contains', '原料',     'out', '材料采购', '原料',   '原料采购'),
(true, 205, 'any', 'contains', '商品',     'out', '材料采购', '商品',   '商品采购'),

-- ============================================================
-- 装修（out）- 优先级 210-219
-- ============================================================
(true, 210, 'any', 'contains', '装修',     'out', '装修', '装修费',    '装修工程款'),
(true, 211, 'any', 'contains', '装饰',     'out', '装修', '装饰费',    '装饰工程款'),
(true, 212, 'any', 'contains', '施工',     'out', '装修', '施工费',    '施工费'),
(true, 213, 'any', 'contains', '工程',     'out', '装修', '工程款',    '工程款'),
(true, 214, 'any', 'contains', '拆除',     'out', '装修', '拆除费',    '拆除费用'),

-- ============================================================
-- 租金物业/水电（out）- 优先级 220-229
-- ============================================================
(true, 220, 'any', 'contains', '租金',     'out', '租金物业', '租金',   '房屋租金'),
(true, 221, 'any', 'contains', '物业费',   'out', '租金物业', '物业费', '物业管理费'),
(true, 222, 'any', 'contains', '房租',     'out', '租金物业', '房租',   '房租'),
(true, 223, 'any', 'contains', '水费',     'out', '租金物业', '水费',   '水费'),
(true, 224, 'any', 'contains', '电费',     'out', '租金物业', '电费',   '电费'),
(true, 225, 'any', 'contains', '燃气',     'out', '租金物业', '燃气费', '燃气费'),
(true, 226, 'any', 'contains', '空调',     'out', '租金物业', '空调费', '空调费'),

-- ============================================================
-- 人力（out）- 优先级 230-239
-- ============================================================
(true, 230, 'any', 'contains', '工资',     'out', '人力', '工资',      '员工工资'),
(true, 231, 'any', 'contains', '薪酬',     'out', '人力', '薪酬',      '员工薪酬'),
(true, 232, 'any', 'contains', '社保',     'out', '人力', '社保',      '社保费用'),
(true, 233, 'any', 'contains', '公积金',   'out', '人力', '公积金',    '公积金'),
(true, 234, 'any', 'contains', '劳务',     'out', '人力', '劳务费',    '劳务费'),
(true, 235, 'any', 'contains', '派遣',     'out', '人力', '派遣费',    '派遣费'),
(true, 236, 'any', 'contains', '招聘',     'out', '人力', '招聘费',    '招聘费用'),
(true, 237, 'any', 'contains', '培训',     'out', '人力', '培训费',    '培训费用'),

-- ============================================================
-- 运费（out）- 优先级 240-249
-- ============================================================
(true, 240, 'any', 'contains', '货拉拉',   'out', '运费', '货拉拉',    '货拉拉运费'),
(true, 241, 'any', 'contains', '快递',     'out', '运费', '快递',      '快递费用'),
(true, 242, 'any', 'contains', '物流',     'out', '运费', '物流',      '物流费用'),
(true, 243, 'any', 'contains', '同城',     'out', '运费', '同城配送',  '同城配送'),
(true, 244, 'any', 'contains', '闪送',     'out', '运费', '闪送',      '闪送费用'),
(true, 245, 'any', 'contains', '配送',     'out', '运费', '配送费',    '配送费用'),
(true, 246, 'any', 'contains', '运输',     'out', '运费', '运输费',    '运输费用'),

-- ============================================================
-- 管理费用（out）- 优先级 250-269
-- ============================================================
(true, 250, 'any', 'contains', '办公',     'out', '管理费用', '办公费',   '办公用品/办公费用'),
(true, 251, 'any', 'contains', '通讯',     'out', '管理费用', '通讯费',   '通讯费用'),
(true, 252, 'any', 'contains', '差旅',     'out', '管理费用', '差旅费',   '差旅费用'),
(true, 253, 'any', 'contains', '招待',     'out', '管理费用', '招待费',   '业务招待费'),
(true, 254, 'any', 'contains', '交通',     'out', '管理费用', '交通费',   '交通费用'),
(true, 255, 'any', 'contains', '汽车',     'out', '管理费用', '车辆费',   '汽车相关费用'),
(true, 256, 'any', 'contains', '维修',     'out', '管理费用', '维修费',   '维修保养费'),
(true, 257, 'any', 'contains', '保养',     'out', '管理费用', '保养费',   '保养费用'),
(true, 258, 'any', 'contains', '保险',     'out', '管理费用', '保险费',   '保险费用'),
(true, 259, 'any', 'contains', '咨询',     'out', '管理费用', '咨询费',   '咨询服务费'),
(true, 260, 'any', 'contains', '审计',     'out', '管理费用', '审计费',   '审计费用'),
(true, 261, 'any', 'contains', '法律',     'out', '管理费用', '法律费',   '法律服务费'),
(true, 262, 'any', 'contains', '软件',     'out', '管理费用', '软件费',   '软件服务费'),
(true, 263, 'any', 'contains', '系统',     'out', '管理费用', '系统使用费','系统使用费'),
(true, 264, 'any', 'contains', '服务',     'out', '管理费用', '其他服务', '其他服务费'),

-- ============================================================
-- 财务费用（out）- 优先级 270-279
-- ============================================================
(true, 270, 'any', 'contains', '利息',     'out', '财务费用', '利息支出', '利息支出'),
(true, 271, 'any', 'contains', '贷款',     'out', '财务费用', '贷款利息', '贷款利息'),
(true, 272, 'any', 'contains', '融资',     'out', '财务费用', '融资费用', '融资费用'),

-- ============================================================
-- 销售费用（out）- 优先级 280-299
-- ============================================================
(true, 280, 'any', 'contains', '营销',     'out', '销售费用', '营销费',   '营销推广费'),
(true, 281, 'any', 'contains', '推广',     'out', '销售费用', '推广费',   '推广费用'),
(true, 282, 'any', 'contains', '广告',     'out', '销售费用', '广告费',   '广告费用'),
(true, 283, 'any', 'contains', '宣传',     'out', '销售费用', '宣传费',   '宣传费用'),
(true, 284, 'any', 'contains', '促销',     'out', '销售费用', '促销费',   '促销费用'),
(true, 285, 'any', 'contains', '包装',     'out', '销售费用', '包装费',   '包装费用'),
(true, 286, 'any', 'contains', '损耗',     'out', '销售费用', '损耗',     '损耗费用'),

-- ============================================================
-- 其他（out）- 优先级 800-899
-- ============================================================
(true, 800, 'any', 'contains', '退款',     'out', '其他', '退款',       '退款支出'),
(true, 801, 'any', 'contains', '赔偿',     'out', '其他', '赔偿',       '赔偿支出'),
(true, 802, 'any', 'contains', '罚款',     'out', '其他', '罚款',       '罚款支出'),
(true, 803, 'any', 'contains', '捐赠',     'out', '其他', '捐赠',       '捐赠支出'),

-- ============================================================
-- 兜底规则（优先级 999）
-- ============================================================
(true, 999, 'any', 'regex', '.*', 'any', '未分类', null, '兜底规则：未匹配到任何规则的流水')
    on conflict do nothing;
  END IF;
END $$;

------------------------------------------------------------
-- T4.2 人工匹配覆盖表（DM）
------------------------------------------------------------
create schema if not exists yufeng_dm;

-- 人工 override 表：存储人工分类兜底结果
-- 优先级：override > rule > 未分类
create table if not exists yufeng_dm.bank_txn_override (
    id              bigserial primary key,
    bank_txn_id     bigint not null unique,  -- FK -> yufeng_ods.bank_txn.id

    lvl1            text not null,
    lvl2            text,
    note            text,

    created_by      text not null default 'ui',  -- 默认 'ui'（无需登录）
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- 索引：加速查询
create index if not exists idx_override_bank_txn_id on yufeng_dm.bank_txn_override(bank_txn_id);
create index if not exists idx_override_lvl1 on yufeng_dm.bank_txn_override(lvl1);

------------------------------------------------------------
-- T2.4 规则命中计算函数
-- 优先级：override > rule > unclassified
-- 输出：matched_rule_id, lvl1, lvl2, classified_source
------------------------------------------------------------
-- 先删除已存在的 type 和 function，确保幂等
DROP TYPE IF EXISTS yufeng_dm.classify_result CASCADE;
DROP FUNCTION IF EXISTS yufeng_dm.fn_classify_bank_txn(bigint) CASCADE;

-- 创建 composite type（解决 view 中无法识别 record 字段名的问题）
CREATE TYPE yufeng_dm.classify_result AS (
    matched_rule_id bigint,
    lvl1 text,
    lvl2 text,
    classified_source text
);

create or replace function yufeng_dm.fn_classify_bank_txn(p_bank_txn_id bigint)
returns yufeng_dm.classify_result as $$
declare
    v_counterparty_name text;
    v_summary text;
    v_memo text;
    v_purpose text;
    v_in_amt numeric;
    v_out_amt numeric;

    v_rule_id bigint;
    v_lvl1 text;
    v_lvl2 text;
    v_classified_source text;

    rec record;
begin
    -- 获取原始流水字段
    select
        t.counterparty_name,
        t.summary,
        t.memo,
        t.purpose,
        t.in_amt,
        t.out_amt
    into v_counterparty_name, v_summary, v_memo, v_purpose, v_in_amt, v_out_amt
    from yufeng_ods.bank_txn t
    where t.id = p_bank_txn_id;

    -- Step 1: 检查 override（优先级最高）
    select o.lvl1, o.lvl2, o.bank_txn_id
    into v_lvl1, v_lvl2, v_rule_id
    from yufeng_dm.bank_txn_override o
    where o.bank_txn_id = p_bank_txn_id;

    if found then
        v_classified_source := 'override';
        return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
    end if;

    -- Step 2: 检查规则匹配（first-match by priority）
    for rec in (
        select r.rule_id, r.lvl1, r.lvl2, r.priority
        from yufeng_cfg.bank_rule_map r
        where r.enabled = true
          and (
            (r.direction = 'any')
            or (r.direction = 'in' and v_in_amt is not null and v_in_amt > 0)
            or (r.direction = 'out' and v_out_amt is not null and v_out_amt > 0)
          )
          and (
            (r.match_field = 'any' and (
                v_counterparty_name ilike '%' || r.match_value || '%'
                or v_summary ilike '%' || r.match_value || '%'
                or v_memo ilike '%' || r.match_value || '%'
                or v_purpose ilike '%' || r.match_value || '%'
            ))
            or (r.match_field = 'counterparty_name' and v_counterparty_name ilike '%' || r.match_value || '%')
            or (r.match_field = 'summary' and v_summary ilike '%' || r.match_value || '%')
            or (r.match_field = 'memo' and v_memo ilike '%' || r.match_value || '%')
            or (r.match_field = 'purpose' and v_purpose ilike '%' || r.match_value || '%')
          )
        order by r.priority asc
        limit 1
    ) loop
        v_rule_id := rec.rule_id;
        v_lvl1 := rec.lvl1;
        v_lvl2 := rec.lvl2;
        v_classified_source := 'rule';
        return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
    end loop;

    -- Step 3: 未分类
    v_rule_id := null;
    v_lvl1 := '未分类';
    v_lvl2 := null;
    v_classified_source := 'unclassified';
    return row(v_rule_id, v_lvl1, v_lvl2, v_classified_source);
end;
$$ language plpgsql;

------------------------------------------------------------
-- T2.4 规则命中计算视图（classified）
-- 整合 override + rule + unclassified 结果
------------------------------------------------------------
create or replace view yufeng_dm.v_bank_txn_classified as
select
    t.id as bank_txn_id,
    t.store_code,
    t.txn_time,
    t.counterparty_name,
    t.summary,
    t.memo,
    t.purpose,
    t.in_amt,
    t.out_amt,

    -- 分类结果（来自函数计算）
    (yufeng_dm.fn_classify_bank_txn(t.id)).matched_rule_id as matched_rule_id,
    (yufeng_dm.fn_classify_bank_txn(t.id)).lvl1 as lvl1,
    (yufeng_dm.fn_classify_bank_txn(t.id)).lvl2 as lvl2,
    (yufeng_dm.fn_classify_bank_txn(t.id)).classified_source as classified_source,

    -- 额外信息
    t.source_file_id
from yufeng_ods.bank_txn t;

------------------------------------------------------------
-- 覆盖写回函数（UI 调用）
-- 说明：UI 保存时调用此函数写入 override 表
------------------------------------------------------------
create or replace function yufeng_dm.upsert_bank_txn_override(
    p_bank_txn_id bigint,
    p_lvl1 text,
    p_lvl2 text,
    p_note text,
    p_created_by text default 'ui'
)
returns void as $$
begin
    insert into yufeng_dm.bank_txn_override (bank_txn_id, lvl1, lvl2, note, created_by)
    values (p_bank_txn_id, p_lvl1, p_lvl2, p_note, p_created_by)
    on conflict (bank_txn_id) do update set
        lvl1 = excluded.lvl1,
        lvl2 = excluded.lvl2,
        note = excluded.note,
        updated_at = now();
end;
$$ language plpgsql;

------------------------------------------------------------
-- 覆盖删除函数（UI 调用）
-- 说明：删除 override，恢复为规则匹配/未分类
------------------------------------------------------------
create or replace function yufeng_dm.delete_bank_txn_override(p_bank_txn_id bigint)
returns void as $$
begin
    delete from yufeng_dm.bank_txn_override where bank_txn_id = p_bank_txn_id;
end;
$$ language plpgsql;

------------------------------------------------------------
-- T2.5 覆盖率统计视图（按月）
------------------------------------------------------------
create or replace view yufeng_dm.v_coverage_monthly as
select
    to_char(t.txn_time, 'YYYY-MM') as month,
    count(*) as total_rows,
    sum(case when c.lvl1 != '未分类' then 1 else 0 end) as covered_rows,
    sum(case when c.lvl1 = '未分类' then 1 else 0 end) as unclassified_rows,
    round(sum(case when c.lvl1 != '未分类' then 1 else 0 end) * 100.0 / count(*), 2) as coverage_pct,

    sum(case when c.lvl1 != '未分类' then coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0) else 0 end) as covered_amt,
    sum(case when c.lvl1 = '未分类' then coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0) else 0 end) as unclassified_amt
from yufeng_ods.bank_txn t
left join yufeng_dm.v_bank_txn_classified c on t.id = c.bank_txn_id
group by to_char(t.txn_time, 'YYYY-MM')
order by month desc;

------------------------------------------------------------
-- T2.6 未分类 Top 对方单位/摘要（用于补规则）
------------------------------------------------------------
create or replace view yufeng_dm.v_unclassified_top as
select
    c.counterparty_name,
    c.summary,
    c.memo,
    count(*) as cnt,
    sum(coalesce(c.in_amt, 0) + coalesce(c.out_amt, 0)) as total_amt
from yufeng_dm.v_bank_txn_classified c
where c.lvl1 = '未分类'
group by c.counterparty_name, c.summary, c.memo
order by cnt desc
limit 20;

------------------------------------------------------------
-- 验证查询（可单独执行）
------------------------------------------------------------
-- 1. 规则条数
-- select count(*) as rule_count from yufeng_cfg.bank_rule_map;

-- 2. 分类覆盖率
-- select * from yufeng_dm.v_coverage_monthly;

-- 3. 未分类 Top
-- select * from yufeng_dm.v_unclassified_top;
