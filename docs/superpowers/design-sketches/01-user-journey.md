# WDG Agent-First Product — Target User Journey

> Two target users on a single product. B is short-term; A is long-term.
> B's value compounds into A — the artifacts B creates (rules, insights, comments) become A's reference corpus.

## B. 财务/运营分析师 (short-term primary)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  DAY 1 — Monday morning                                                 │
│                                                                          │
│  9:00  收到银行流水邮件,直接拖进 Chat 浮窗                                │
│        > Agent: "检测到 47 笔未分类,建议 12 条规则(预览)"                │
│        > 用户: "展开第 3 条,为什么要这样分?"                              │
│        > Agent: "对方为'美团',且历史 28 笔同对手均归 INCOME_QIMAI"        │
│        > 用户: "同意,提交审批"                                           │
│        > Agent: ✓ 12 条 proposal 已提交,等 1 位 admin 审                  │
│                                                                          │
│ 10:30  老板微信问"上周瑞安店利润"                                        │
│        > 用户: Chat 里问"瑞安店上周利润"                                  │
│        > Agent 自动: 拉 v_profit + v_cashflow, 拉反洗 (MKT/HR/MATERIAL) │
│        > 给出图表 + 一句话诊断 ("主因: MKT 支出 +18%")                   │
│        > 用户: "把这段写进月报"  → Agent 生成 markdown 草稿               │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              │   B 的产出沉淀:
                              │   · bank_rule_map (B 审过的规则)
                              │   · proposal_history (B 的判断)
                              │   · monthly_report_drafts (B 的解读)
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LONG-TERM — corpus grows → A becomes feasible                           │
└──────────────────────────────────────────────────────────────────────────┘

## A. 经营老板 (long-term, B's byproduct)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  老板打开手机,问:"本月我三家店谁最值得扩张?"                              │
│                                                                          │
│  Agent (自动,无需人跑数):                                                │
│    1. 拉 KPI 趋势 × 3 品牌                                              │
│    2. 拉 unit economics (revenue/store, cogs%, labor%)                   │
│    3. 读历史 proposal 注释 (B 留下的"为什么这样分"语料)                  │
│    4. 给出建议: "温州万象城 labor% 健康 + 翻台高;考虑 Q4 试开"          │
│                                                                          │
│  老板: "为什么不是瑞安?"                                                  │
│  Agent: "瑞安 MKT/RENT 高 22%, unit margin 倒挂 4 个月"                 │
│  Agent: "要我把这条判断发到瑞安店店长?"  → 一键派单                       │
└──────────────────────────────────────────────────────────────────────────┘

## 边界: Agent 写权限两阶段 (B/A 共用)

| 操作                    | 老板 (A) | 分析师 (B) | 审批员 (human) |
|-------------------------|:--------:|:----------:|:--------------:|
| 提问 / 看报表          |    ✓    |     ✓     |       ✓       |
| 触发 Agent 分析        |    ✓    |     ✓     |       ✓       |
| 提交 proposal (规则)   |    ✗    |     ✓     |       ✓       |
| 审批 proposal           |    ✗    |     ✗     |       ✓       |
| 修改 cfg / 改 schema   |    ✗    |     ✗     |       ✓       |
| 派单 / 通知门店        |    ✓    |     ✓     |       ✓       |

**关键**: A 的"派单"也是受控的,A 写的所有动作都进审批队列,只是 A 看到的是"已经自动审过"的轻量级确认(在 v1 还做不到,先做审批模式,v2 引入白名单动作)。
```
