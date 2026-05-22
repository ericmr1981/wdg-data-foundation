# Yufeng｜T2 bank_rule_map 设计与初版规则（关键词分类）

> 背景：Yufeng 银行流水源文件无 K 类“费用明细”字段；一期需要用规则把每笔流水归类到 `lvl1/lvl2`，用于生成费用表与收入对账。

## 1) 目标
- 自动给每条 `yufeng_ods.bank_txn` 打上：
  - `direction`：in/out
  - `lvl1`：营业收入 / 手续费 / 税金 / 租金物业 / 人力 / 运费 / 管理费用 / 其他 / 未分类
  - `lvl2`：（可空）
- 规则可配置、可迭代，不改代码即可增删规则
- 输出覆盖率统计：命中规则占比、未分类清单（用于持续完善）

## 2) 规则表设计（建议）
### 2.1 规则表：`yufeng_cfg.bank_rule_map`
字段建议：
- rule_id bigserial PK
- enabled boolean
- priority int（越小优先级越高）
- match_field text（counterparty_name/summary/memo/purpose/any）
- match_type text（contains/regex）
- match_value text
- direction text（in/out/any）
- lvl1 text
- lvl2 text nullable
- note text

规则执行：
- 按 priority 升序，命中第一条即停止（first-match wins）
- direction=any 时不限制金额方向；否则要求：
  - in：in_amt not null and in_amt>0
  - out：out_amt not null and out_amt>0
- 未命中：lvl1='未分类'

### 2.2 分类结果表（建议，便于追溯）：`yufeng_dm.bank_txn_classified`
- bank_txn_id
- store_code
- txn_time
- in_amt/out_amt
- matched_rule_id
- lvl1/lvl2
- classified_at

> 一期也可以先用 dbt view 生成，不一定落物理表。

## 3) 初版规则策略（一期覆盖优先级）
1. **营业收入（in）**：第三方平台/支付公司回款
2. **往来/借款/注资/还款（in）**：股东往来、借款人还款、注资、投资款等
3. **手续费（out）**：银行/支付通道扣费
4. **税金（out）**：税务扣款（增值税等）
5. **材料采购/货款/物料（out）**：原材料、商品采购
6. **装修（out）**：装修工程/装饰/施工
7. **租金物业/水电（out）**：对方单位/附言含”物业/租金/水费/电费”等
8. **人力（out）**：工资/社保/服务费（对方单位为人力服务公司或附言含工资）
9. **运费（out）**：货拉拉/同城/快递/闪送等
10. **管理费用（out）**：办公/系统/差旅/维修等（先粗分到管理费用）
11. **财务费用（out）**：利息支出/贷款/融资费用
12. **销售费用（out）**：营销/推广/广告/宣传
13. 兜底：其他/未分类

## 3.1 分类体系（lvl1/lvl2）

### 一级分类（lvl1）集合
- **营业收入**：美团/饿了么/抖音/京东/微信/支付宝/其他渠道
- **往来/借款**：借款/暂借款/其他往来
- **往来/注资**：注资/投资
- **往来/还款**：收到还款
- **往来/其他**：其他往来款
- **手续费**：服务费/扣费
- **税金**：增值税/所得税/印花税/附加税/其他税金
- **材料采购**：材料/采购/货款/物料/原料/商品
- **装修**：装修费/装饰费/施工费/工程款/拆除费
- **租金物业**：租金/物业费/房租/水费/电费/燃气/空调
- **人力**：工资/薪酬/社保/公积金/劳务/派遣/招聘/培训
- **运费**：货拉拉/快递/物流/同城/闪送/配送/运输
- **管理费用**：办公/通讯/差旅/招待/交通/车辆/维修/保养/保险/咨询/审计/法律/软件/系统
- **财务费用**：利息/贷款/融资
- **销售费用**：营销/推广/广告/宣传/促销/包装/损耗
- **其他**：退款/赔偿/罚款/捐赠
- **未分类**：兜底

## 4) 初版规则优先级
> 说明：以下是”规则形态示例”。拿到你们确认的分类口径后，我会把真实关键词补全并在文件中持续维护。

优先级范围：
- 10-19：营业收入（in）
- 30-39：往来/借款/注资/还款（in）
- 110-119：手续费（out）
- 120-129：税金（out）
- 200-209：材料采购/货款/物料（out）
- 210-219：装修（out）
- 220-229：租金物业/水电（out）
- 230-239：人力（out）
- 240-249：运费（out）
- 250-269：管理费用（out）
- 270-279：财务费用（out）
- 280-299：销售费用（out）
- 800-899：其他（out）
- 999：兜底

示例（实际规则已入库到 sql/yufeng_apply_classification.sql）：
- P10：match_field=any contains "美团" direction=in → lvl1=营业收入,lvl2=美团
- P11：match_field=any contains "饿了么" direction=in → lvl1=营业收入,lvl2=饿了么
- P30：match_field=any contains "借款" direction=in → lvl1=往来/借款,lvl2=借款
- P31：match_field=any contains "注资" direction=in → lvl1=往来/注资,lvl2=注资
- P33：match_field=any contains "还款" direction=in → lvl1=往来/还款,lvl2=还款
- P110：match_field=any contains "手续费" direction=out → lvl1=手续费
- P120：match_field=any contains "增值税" direction=out → lvl1=税金,lvl2=增值税
- P200：match_field=any contains "材料" direction=out → lvl1=材料采购,lvl2=材料
- P201：match_field=any contains "货款" direction=out → lvl1=材料采购,lvl2=货款
- P210：match_field=any contains "装修" direction=out → lvl1=装修,lvl2=装修费
- P220：match_field=any contains "物业" direction=out → lvl1=租金物业,lvl2=物业费
- P230：match_field=any contains "工资" direction=out → lvl1=人力,lvl2=工资
- P240：match_field=any contains "货拉拉" direction=out → lvl1=运费
- P250：match_field=any contains "办公" direction=out → lvl1=管理费用,lvl2=办公费
- P270：match_field=any contains "利息" direction=out → lvl1=财务费用,lvl2=利息支出
- P280：match_field=any contains "营销" direction=out → lvl1=销售费用,lvl2=营销费
- P999：match_field=any regex ".*" direction=any → lvl1=未分类

## 5) 覆盖率/未分类清单（一期交付）
- 输出每月：
  - 总笔数、命中笔数、命中率
  - 未分类金额（in/out）
  - 未分类 Top 对方单位/摘要/附言（用于补规则）

## 6) 当前覆盖率（基于工行样例的快速试算，非最终）
我用“非常粗”的关键词规则先跑了一遍（仅用于回答覆盖率问题）：
- **按笔数覆盖率（命中核心lvl1，不含‘其他/未分类’）**：约 **74.04%（231/312）**
- **按金额覆盖率**：约 **21.50%**
  - 原因：当前最大金额的对方单位（如“上海昀珀企业管理有限公司/温州坤吉堂/陈坤龙/上海紫如灵”等）尚未纳入明确规则，暂被归入“其他收入/其他支出”，导致金额覆盖偏低。

粗略渠道（lvl2）拆分（仅对转入）：
- 识别到：美团/饿了么/抖音；其余大量转入落在“其他渠道”（说明需要补充更多渠道/收款主体关键词）。

## 7) 已确认
- 一级分类（lvl1）集合：已定稿 **营业收入/往来/借款/注资/还款/手续费/税金/材料采购/装修/租金物业/人力/运费/管理费用/财务费用/销售费用/其他/未分类**
- 你已确认”需要二级分类”：lvl2=渠道（美团/饿了么/抖音/京东/微信/支付宝/其他渠道），其他费用按需细分
- 一键落库 SQL 已生成：`sql/yufeng_apply_classification.sql`
- 初版规则已入库：共约 90+ 条规则，覆盖主要分类
- 验证脚本已生成：`scripts/verify_yufeng_classification.py`
