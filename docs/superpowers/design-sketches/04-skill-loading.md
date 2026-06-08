# WDG — Skill 加载到 system prompt 的两种实现

## 方案 X: "Skill 全文一次性塞进 system prompt"

```
┌────────────────────────────────────────────────────┐
│ system prompt                                      │
│                                                    │
│  1. 角色: "你是 WDG 的数据分析 Agent..."            │
│  2. 工具: 45 个 MCP tool 描述 (来自 MCP /list)     │
│  3. 用户偏好: (空, 没有长期记忆)                   │
│  4. 业务上下文: 品牌清单, 财务表清单               │
│  5. SKILLS:                                        │
│     ── weekly-bank-review (full) ─────────         │
│     你每周一早上用这个 skill ...                   │
│     ## 工作流                                      │
│     1. get_pipeline_kpi ...                        │
│     2. get_unclassified_by_file ...                │
│     ...                                            │
│     ── monthly-financial-summary (full) ────       │
│     ...                                            │
│     ── qimai-revenue-anomaly (full) ────────       │
│     ...                                            │
│                                                    │
│  N. 输出格式: 中文, 简洁, 数字带千分位             │
└────────────────────────────────────────────────────┘
                              ▲
                              │
                    LLM 一次性看到所有 skill 全文
                    (10 个 skill ≈ 3-5K tokens)
```

优点:
- 实现最简: 启动时一次性拼好
- LLM 任何时候都能 reference 所有 skill

缺点:
- 上下文消耗大 (10 个 skill = 几 K tokens 永远占用)
- 加载 50 个 skill 时成本线性上升
- LLM 在不需要某个 skill 时也会读到,可能"误用"

---

## 方案 Y: "Skill 按需展开,description 常驻"

```
┌────────────────────────────────────────────────────┐
│ system prompt (常驻, ~500 tokens)                  │
│                                                    │
│  1. 角色 + 工具 + 业务上下文                       │
│                                                    │
│  2. SKILL INDEX (只列 name + description):         │
│     · weekly-bank-review — 当用户问"周报"或"上周 │
│       银行流水复盘"时用                            │
│     · monthly-financial-summary — 当用户问"月报"  │
│       或"月度财务"时用                             │
│     · qimai-revenue-anomaly — 当用户问"为什么     │
│       收入下降"时用                                │
│     · bulk-propose-rules — 当用户要求批量提规则时  │
│     · export-monthly-pdf — 当用户要"导出 PDF"时   │
│     (10 个 skill 描述 ≈ 500 tokens)                │
│                                                    │
│  3. 工具: 45 个 MCP tool 描述                      │
│                                                    │
│  4. 输出格式                                       │
└────────────────────────────────────────────────────┘
                              ▲
                              │ LLM 决定要不要展开某个 skill
                              ▼
                    ┌────────────────────┐
                    │  EXPAND: weekly-... │
                    │  (返回完整 SKILL.md) │
                    │  ~1K tokens         │
                    │  → 临时插入到对话   │
                    │    的 system /      │
                    │    user message 里  │
                    └────────────────────┘
```

实现机制: 一个特殊的 MCP tool (或专用 endpoint) `load_skill(name)`, Agent 觉得需要时调,服务端把全文塞进当前对话上下文。

优点:
- 常驻 token 小 (description 列表 ≈ 500 tokens)
- 100 个 skill 也无所谓
- LLM 主动"按需加载",符合"使用"语义

缺点:
- 实现稍复杂 (需要 expand 机制)
- LLM 要"知道"要 load (需要 prompt 引导)

---

## 我推荐: Y 方案

理由:
- 长期看,skill 数量会增长 (月报 / 周报 / 异常分析 / 批量审批 / 数据导出 / 门店对比 ...), 一次性塞满不 scale
- 500 tokens 的 skill index 几乎无成本
- expand 机制一旦实现就是通用能力,未来还能扩展到"加载历史对话" / "加载报告模板" 等
- 实现复杂度只多 1 个 MCP tool (`load_skill`) + 1 段 server-side 拼装逻辑

但有一个**重要变体**: 在 v1 skill 数量 < 5 时,X 和 Y 差别不大,可以先 X,Y 后续加。

**你的选择?**
- X (简单, skill 少时 OK)
- Y (推荐, 长 scale)
- 先 X 后 Y (渐进, v1 = X, v1.1 = Y)
