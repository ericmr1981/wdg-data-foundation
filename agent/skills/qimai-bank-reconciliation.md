---
name: qimai-bank-reconciliation
description: |
  企迈订单与银行流水对账. 涵盖 7 个渠道的对账工具.
  用户问"入账率/对账/未入账/reconciliation"时加载.
triggers:
  - "入账率"
  - "对账"
  - "未入账"
  - "reconciliation"
  - "entry rate"
  - "third_party_txn_no"
  - "到账"
  - "settlement"
  - "结算"
  - "对不上"
---

# 企迈-银行 对账工具指南

## 前置入口

先调 `get_qimai_entry_rate(brand, period)` 看各渠道入账率总览, 再按需调具体渠道的对账明细.

## 渠道对账工具

### 1. 结算周期对账 (泰柯)

**工具**: `get_settlement_cycle_recon(brand=tamkoko, period?, span?, store?)`

- 端点: `/api/income/cycle-recon`
- 适用: 泰柯茶园 (苏州泰柯统一结算)
- 说明: 按结算周期(周/月)对比企迈订单金额与银行入账金额, 逐月聚合.
- 泰柯的 WECHAT + ALIPAY 走苏州泰柯母公司转账, 入账率和延迟不可直接类比美团/抖音.

### 2. 网商银行对账 (泰柯)

**工具**: `get_taobao_recon(brand=tamkoko, period?, span?, store?)`

- 端点: `/api/income/taobao-recon`
- 适用: 泰柯茶园 网商银行 (Rule 421)
- 算法: LAG-based 窗口匹配, 每笔银行入账覆盖 [前笔+1天, 当前入账日-3天] 的企迈订单.
- 返回逐笔银行入账匹配到的企迈订单明细.

### 3. 美团对账 (泰柯)

**工具**: `get_meituan_recon(brand=tamkoko, period?, span?, store?, t_offset=3)`

- 端点: `/api/income/meituan-recon`
- 适用: 泰柯茶园 钱袋宝 (Rules 665/327)
- 默认 T+3入账.
- **排除团购**(美团团购走独立结算).
- 返回每日汇总对比: Qimai 订单金额 vs 银行入账.

### 4. 抖音对账 (泰柯)

**工具**: `get_douyin_recon(brand=tamkoko, period?, span?, store?, t_offset=5)`

- 端点: `/api/income/douyin-recon`
- 适用: 泰柯茶园 江苏银行 (Rule 707)
- 抖音团购券, 默认 T+5入账.
- 返回每日汇总对比.

### 5. 微信对账 (蜜可诗)

**工具**: `get_gelato_wechat_recon(brand=gelatomiiix, period?, span?, store?, t_offset=1)`

- 端点: `/api/income/gelato-wechat-recon`
- 适用: 蜜可诗 微信支付 财付通 (Rule 512)
- T+1 daily 结算, 逐笔银行入账匹配企迈订单.

### 6. 支付宝对账 (蜜可诗)

**工具**: `get_gelato_alipay_recon(brand=gelatomiiix, period?, span?, store?, t_offset=0)`

- 端点: `/api/income/gelato-alipay-recon`
- 适用: 蜜可诗 支付宝 支付宝支付科技 (Rules 591/592)
- LAG 算法 (月结算, 入账时间极不规律, 默认 T+0).
- 返回逐笔银行入账及匹配到的企迈订单.

## 通用参数

| 参数 | 说明 |
|---|---|
| `brand` | 品牌代码 |
| `period` | YYYY-MM 格式, 可选; 缺省返回全部 |
| `span` | month / quarter / year |
| `store` | 门店代码过滤 |
| `t_offset` | 银行入账相对于企迈订单日期的偏移天数, 选填 |

## 注意事项

1. **排序**: 先调 `get_qimai_entry_rate` 看总览, 再调具体渠道明细.
2. **T+N 偏移**: 每个渠道的 T+N 是业务经验值. 用户可调整 `t_offset` 参数改变窗口. 不同门店可能有不同延迟.
3. **入账率口径**: 入账率=银行已入账金额/企迈订单金额. 未入账的订单需人工核实.
4. **上游数据库**: 所有对账工具都读 `bank_txn_classified_snapshot` (预分类快照), 口径统一.
5. **蜜可诗独家**: WECHAT/ALIPAY 走财付通/支付宝支付科技直接结算, 可逐笔对账. 泰柯的 WECHAT/ALIPAY 走苏州泰柯母公司转账, 走 `get_settlement_cycle_recon` 看月/周汇总.
6. **团购排除**: 泰柯的美团团购独立结算, 走 `meituan-tuangou-recon` (如有需要). `get_meituan_recon` 默认不包含团购.