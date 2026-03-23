# Yufeng｜数据库架构与字段口径（一期）

## 0. 品牌与门店
- brand_code：`Yufeng`
- 门店（store_code）
  - 榆枫国华：`yf_gh`

## 1. Schema 命名（方案B：同库分品牌schema）
> 建议采用前缀：`yufeng_raw / yufeng_ods / yufeng_cfg / yufeng_dm`

- `yufeng_raw`：文件登记/追溯
- `yufeng_ods`：源表结构化
- `yufeng_cfg`：字典/关键词规则（银行流水分类）
- `yufeng_dm`：报表输出

## 2. 输入数据源（一期）
- 银行流水单（Excel）
  - 当前样例：`inputs/银行流水_工行_250301-250731.xlsx`
  - 字段（表头行）：本方账号、交易时间、对方单位、对方账号、转入金额、转出金额、余额、摘要、用途、附言
  - 特性：无“费用明细K分类”，需规则/字典自动归类
- 营业数据：本品牌暂未提供（后续补齐后再定义 yufeng_ods.sales_*）

## 3. ODS 表结构（一期最小）
### 3.1 `yufeng_ods.bank_txn`（由银行流水导入）
> 粒度：逐笔流水

字段（定稿 v0）：
- store_code text default 'yf_gh'
- self_acct text
- txn_time timestamptz
- counterparty_name text
- counterparty_acct text
- in_amt numeric(14,2)
- out_amt numeric(14,2)
- balance_amt numeric(14,2)
- summary text
- purpose text
- memo text
- source_file_id bigint
- created_at timestamptz

清洗规则：
- 金额字段去逗号、空串→NULL
- txn_time 解析失败→落入异常表/记录

字段映射与清洗规则详见：`brand-docs/Yufeng_T1_字段映射与清洗规则.md`
DDL 参考：`brand-docs/Yufeng_ODS_DDL.sql`

## 4. 分类规则（一期核心：`yufeng_cfg.bank_rule_map`）
> 用于把流水自动归类到 lvl1/lvl2，替代原先 Excel 的 K 列。

建议表结构：
- rule_id bigserial
- enabled bool
- priority int（数值越小优先级越高）
- match_field text（counterparty_name/summary/memo/purpose/any）
- match_type text（contains/regex）
- match_value text
- direction text（in/out）
- lvl1 text（营业收入/手续费/税金/运费/租金物业/人力/管理费用/其他）
- lvl2 text（可空）

规则执行：
- 按 priority 顺序匹配第一条命中的规则
- 未命中：归类为 lvl1='未分类'

## 5. DM 输出（一期）
### 5.1 `yufeng_dm.revenue_monthly`
- revenue_bank_amt = sum(in_amt where lvl1='营业收入')
- revenue_sales_amt：本品牌未接入营业数据前，置空或 0
- diff_amt：sales - bank

### 5.2 `yufeng_dm.expense_monthly`
- expense_amt = sum(out_amt group by (month, lvl1, lvl2)

### 5.3 `yufeng_dm.profit_monthly`
- 汇总收入两口径（当前以银行为主）+ 各费用（来自 expense_monthly）

## 6. 待补齐（进入下一阶段前）
- Yufeng 品牌营业数据报告样例（用于建立业务收入口径与对账）
- 关键词规则初版：先覆盖 美团/饿了么/抖音/钱袋宝/富友 等回款=营业收入；手续费/税金/租金/人力等支出
