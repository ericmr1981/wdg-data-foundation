# Bonjur｜T1 字段映射与清洗规则（营业数据报告 → ODS）

## 1) 输入文件
- 文件：`inputs/营业数据_自助营业取数_2026-02.csv`
- 粒度：门店 + 月（YYYY-MM）
- 注意：存在“汇总：”行（门店列为“汇总：”），ETL 必须过滤。

## 2) 门店名 → store_code 映射
| 门店(源数据) | store_code |
|---|---|
| 温州瓯海万象城店 | wz_oh_wxc |
| 温州瑞安吾悦广场店 | wz_ra_wy |
| 杭州in77 | hz_in77 |

## 3) 字段映射（CSV → bonjur_ods.sales_monthly）
目标表：`bonjur_ods.sales_monthly`

| CSV列名 | 目标字段 | 类型 | 规则/说明 |
|---|---|---|---|
| 门店 | store_name | text | 原始门店名（保留） |
| 门店 | store_code | text | 通过上表映射；映射失败→异常记录 |
| 时间 | month | date | 将 YYYY-MM 转为当月 1 号（YYYY-MM-01） |
| 营业额 | gross_sales_amt | numeric(14,2) | 直接转数值 |
| 优惠总额 | discount_amt | numeric(14,2) | 直接转数值 |
| 营业收入 | revenue_amt | numeric(14,2) | 直接转数值 |
| 有效订单数 | order_cnt | int | 直接转整数 |
| 退款金额 | refund_amt | numeric(14,2) | 直接转数值 |

## 4) 清洗与校验规则（已确认）
1. 过滤：`门店 == '汇总：'` 的行
2. 粒度：**月粒度**（source 为 YYYY-MM）
3. month 存储：YYYY-MM → `YYYY-MM-01`（date）✅
4. 空值处理：金额/订单数空值 → **NULL** ✅
5. 口径校验（soft check）：`revenue_amt` 应≈ `gross_sales_amt - discount_amt`（允许 0.01 误差）
6. 唯一性：`unique(store_code, month)`

## 5) 缺失字段（待后续数据源补齐）
- 业务侧入卡金额/手续费（若未来要与银行对账更精细，需补充）
- 日粒度明细（当前是月汇总；若未来要日趋势看板，需要日数据源）
