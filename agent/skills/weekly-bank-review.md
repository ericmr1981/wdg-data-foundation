---
name: weekly-bank-review
description: |
  周一早上的银行流水复盘. Cron 周一 9:00 自动跑, 也可用户手动问"上周怎么样".
  拉未分类 KPI + 按文件拆解 + 提 proposal 草稿.
triggers:
  - "周报"
  - "上周"
  - "周复盘"
  - "未分类"
  - "weekly"
---

# 周银行流水复盘

## 适用场景

- Cron 触发 (周一 9:00)
- 用户问"上周怎么样" / "周报" / "未分类还有多少"

## 工作流 (5 步)

### Step 1: 拉 KPI 概览
调 `get_pipeline_kpi(brand=$current_brand)`, 拿上周未分类笔数和总额.

### Step 2: 看是哪些文件拖累
调 `get_unclassified_by_file(limit=10, brand=$current_brand)`, 列出未分类最多的 10 个文件.

### Step 3: 拉 top-3 未分类文件的明细
对 Step 2 的 top-3, 各调一次 `get_unclassified_transactions(file_id, limit=50)`.

### Step 4: 对每笔找现有规则候选
对每笔未分类, 调 `get_candidates(txn_id)`, 看现有规则能否匹配.

### Step 5: 提 proposal + 生成报告
- 对无候选的笔, 用 LLM 判断分类 (参考 `bank-classification` skill), 调 `submit_proposal` 提交
- **单次 submit_proposal 不要超过 20 条** (审批人疲劳)
- 同对手出现 ≥ 3 次才建议提规则

## 输出格式

- Markdown 报告
- 数字带千分位, 金额单位: 元
- 包含: 上周未分类笔数 / 总额 / 主要对手 Top-10 / 建议新增规则数
- 不要重复输出"已分类"的数据, 用户已经看过了
- 中文
