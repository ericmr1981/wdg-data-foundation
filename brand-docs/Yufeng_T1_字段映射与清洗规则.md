# Yufeng｜T1 字段映射与清洗规则（银行流水 → ODS）

## 1) 输入文件
- 文件：`inputs/银行流水_工行_250301-250731.xlsx`
- 来源：工行流水导出
- 粒度：逐笔流水
- 门店：榆枫国华（store_code=`yf_gh`）

## 2) 原始表结构识别
- 文件首行包含标记：`[HISTORYDETAIL]`
- 表头位于第 2 行（示例）：
  - 本方账号、交易时间、对方单位、对方账号、转入金额、转出金额、余额、摘要、用途、附言

## 3) 字段映射（Excel → yufeng_ods.bank_txn）
目标表：`yufeng_ods.bank_txn`

| Excel列名 | 目标字段 | 类型 | 规则/说明 |
|---|---|---|---|
| （常量） | store_code | text | 固定为 `yf_gh`（后续多门店时再从文件或配置识别） |
| 交易时间 | txn_time | timestamptz | 解析 `YYYY-MM-DD HH:MM:SS`；失败→异常记录 |
| 对方单位 | counterparty_name | text | 保留 |
| 对方账号 | counterparty_acct | text | 保留（可能包含空值） |
| 转入金额 | in_amt | numeric(14,2) | 去逗号、空串→NULL、转数值 |
| 转出金额 | out_amt | numeric(14,2) | 去逗号、空串→NULL、转数值 |
| 余额 | balance_amt | numeric(14,2) | 去逗号、空串→NULL、转数值 |
| 摘要 | summary | text | 保留 |
| 用途 | purpose | text | 保留 |
| 附言 | memo | text | 保留 |
| 本方账号 | self_acct | text | 保留（用于追溯/对账） |

## 4) 清洗与校验规则（一期建议）
1. 空值策略：金额字段空串→NULL；文本字段空串→NULL
2. 金额字段：去掉千分位逗号（如 `17,343.68` → `17343.68`）
3. 方向校验：同一行通常只会有 in_amt 或 out_amt（允许都为空的异常行→记录）
4. 时间范围：保留原始时间；DM 聚合时按月 `date_trunc('month', txn_time)`
5. 去重策略（soft）：可用（txn_time, counterparty_name, in_amt, out_amt, balance_amt, memo）做近似去重键（一期先不强制）

## 5) 缺失字段/风险点
- 无 K 列分类（fee_detail）：一期需通过 `yufeng_cfg.bank_rule_map` 用关键词规则自动归类
- 可能存在多门店/多账号混在一个流水文件：一期先假设单门店；后续需要 self_acct → store_code 的映射表
