---
name: bank-classification
description: |
  银行流水分类方向规则. 任何涉及银行流水分类推理时加载.
  定义 in/out 方向与类别的对应关系.
triggers:
  - "银行分类"
  - "流水"
  - "in_amt"
  - "out_amt"
---

# Bank Classification Direction Rule

## 核心规则

- `in_amt > 0` (money in) → 只用 `REV_BIZ` 或 `REV_OTHER` (收入类)
- `out_amt > 0` (money out) → 只用 `EXP_*` (支出类: HR / MATERIAL / MKT / RENT_UTIL / SHIP / TAX_SURCHARGE / ADMIN / BUILD / EXP_OTHER)

## 退款陷阱

**绝不**因为 summary 含"退"就归为 expense:
- in_amt > 0 + "退款/退押金/退租金/退货款" → `REV_OTHER` (退款)
- out_amt > 0 + "退款" → 真的可能是支出, 需看对手

## 模糊关键词

用 AND 条件消歧:
- "退款" + 对手"京东" → `REV_OTHER`
- "退款" + 对手"美团" → `REV_OTHER`
- "退款" + 对手"房东" → `RENT_UTIL` (退押金是租金)

## 数字一致

- 金额单位都是元, 不要乘 100
- 摘要里的"¥1,234.56" 跟 in_amt 字段对齐, 不要混淆
