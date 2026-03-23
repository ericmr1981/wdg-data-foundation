# Bonjur｜数据库架构与字段口径（一期）

## 0. 品牌与门店
- brand_code：`Bonjur`
- 门店（store_code）
  - 温州瓯海万象城店：`wz_oh_wxc`
  - 温州瑞安吾悦广场店：`wz_ra_wy`

## 1. Schema 命名（方案B：同库分品牌schema）
> 建议采用前缀：`bonjur_raw / bonjur_ods / bonjur_cfg / bonjur_dm`

- `bonjur_raw`：文件登记/追溯
- `bonjur_ods`：源表结构化
- `bonjur_cfg`：字典/规则（如果营业数据需要额外映射也放这里）
- `bonjur_dm`：报表输出

## 2. 输入数据源（一期）
- 营业数据报告（CSV/Excel）
  - 当前样例：`inputs/营业数据_自助营业取数_2026-02.csv`
  - 字段：门店、时间(YYYY-MM)、营业额、优惠总额、营业收入、有效订单数、退款金额
  - 注意：存在“汇总：”行，ETL需过滤
- 银行流水：本品牌暂未提供（后续补齐后再定义 bonjur_ods.bank_txn）

## 3. ODS 表结构（一期最小）
### 3.1 `bonjur_ods.sales_monthly`（由营业数据报告导入）
> 粒度：**月粒度**（store_code + month）

字段（定稿 v0）：
- store_code text
- store_name text
- month date（YYYY-MM → YYYY-MM-01）
- gross_sales_amt numeric(14,2)      # 营业额
- discount_amt numeric(14,2)         # 优惠总额
- revenue_amt numeric(14,2)          # 营业收入（通常=营业额-优惠）
- order_cnt int                      # 有效订单数
- refund_amt numeric(14,2)           # 退款金额
- source_file_id bigint              # 关联文件登记
- created_at timestamptz

空值策略（已确认）：金额/订单数空值→NULL。

校验规则：
- unique(store_code, month)
- revenue_amt ≈ gross_sales_amt - discount_amt（允许 0.01 误差）

DDL 参考：`brand-docs/Bonjur_ODS_DDL.sql`

## 4. DM 输出（一期）
### 4.1 `bonjur_dm.revenue_monthly`
- revenue_sales_amt：直接取 `sales_monthly.revenue_amt`（或聚合）
- revenue_bank_amt：本品牌未接入银行流水前，置空或 0（以配置控制）
- diff_amt：sales - bank

## 5. 运算逻辑（一期）
- 营业收入（业务口径）= 营业额 - 优惠总额（与源表一致）
- 对账：待接入同品牌银行流水后再启用（规则同 Yufeng：按关键词/映射分类得到“营业收入”入账）

## 6. 待补齐（进入下一阶段前）
- Bonjur 品牌对应的银行流水样例（用于建立 bank_rule_map 与费用表生成）
- 若需要从“门店中文名→store_code”自动映射：补一张 `bonjur_cfg.store_map`
