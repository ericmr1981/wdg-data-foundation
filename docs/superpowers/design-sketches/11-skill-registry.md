# WDG v1 — Skill Registry + load_skill 机制 (Y 方案)

> v0: prompt.ts 里 4 段硬编码字符串, 始终拼在 system prompt
> v1: 字符串搬到 agent/skills/*.md 文件, 启动时 parse 成 Skill 对象,
>     LLM 看到的是 description 列表 (~500 tokens),
>     LLM 主动调 load_skill(name) 展开某个 skill 的全文 (~1K tokens) 到当前对话

## 1. 数据结构

```typescript
// agent/src/skills/types.ts

// 从 SKILL.md 的 YAML frontmatter 解析
export interface SkillFrontmatter {
  name: string                   // 唯一标识, 'weekly-bank-review'
  description: string            // 1-2 句, LLM 据此判断要不要 load
  triggers?: string[]            // 人类可读的关键词 (e.g. ["周报", "上周"])
  version?: string               // 语义化版本
}

// 运行时结构
export interface Skill {
  frontmatter: SkillFrontmatter
  body: string                   // markdown 正文 (去掉 frontmatter 之后)
  fullPath: string               // 磁盘路径
  size: number                   // bytes
  loadedAt: Date                 // 启动时加载时间
}
```

## 2. 启动时扫描 + Parse

```typescript
// agent/src/skills/loader.ts

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'              // npm: gray-matter
import { Skill, SkillFrontmatter } from './types'

const SKILLS_DIR = join(__dirname, '..', '..', 'skills')

/**
 * 启动时调用一次。
 * 扫描 agent/skills/*.md, parse frontmatter, 返回 Skill[]。
 */
export function loadAllSkills(): Skill[] {
  const files = readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'))
  return files.map(f => loadOneSkill(join(SKILLS_DIR, f))).filter(Boolean) as Skill[]
}

function loadOneSkill(path: string): Skill | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as SkillFrontmatter

    if (!fm.name || !fm.description) {
      console.warn(`[skills] ${path}: missing name or description, skip`)
      return null
    }

    return {
      frontmatter: fm,
      body: parsed.content.trim(),
      fullPath: path,
      size: raw.length,
      loadedAt: new Date(),
    }
  } catch (e) {
    console.error(`[skills] ${path}: parse failed`, e)
    return null
  }
}
```

## 3. Skill Registry (内存索引)

```typescript
// agent/src/skills/registry.ts

import { Skill } from './types'
import { loadAllSkills } from './loader'

// 启动时初始化一次
const registry = new Map<string, Skill>()

export function initRegistry() {
  registry.clear()
  for (const s of loadAllSkills()) {
    if (registry.has(s.frontmatter.name)) {
      throw new Error(`[skills] duplicate name: ${s.frontmatter.name}`)
    }
    registry.set(s.frontmatter.name, s)
  }
  console.log(`[skills] loaded ${registry.size} skills`)
}

// ─── 读 ──────────────────────────────────────

// LLM 看到的: description 列表 (~500 tokens)
export function listSkillDescriptions(): string {
  const skills = [...registry.values()]
  return skills
    .map(s => {
      const triggers = s.frontmatter.triggers?.length
        ? ` (触发词: ${s.frontmatter.triggers.join(', ')})`
        : ''
      return `· ${s.frontmatter.name}${triggers} — ${s.frontmatter.description}`
    })
    .join('\n')
}

// LLM 调 load_skill(name) 时返回
export function getSkill(name: string): Skill | null {
  return registry.get(name) ?? null
}

export function getSkillFullText(name: string): string | null {
  const s = registry.get(name)
  return s ? formatSkillForLLM(s) : null
}

// ─── 热重载 (可选, v1 不做) ──────────────────
export function reloadSkill(name: string): void {
  // v1 暂不支持热重载, 改 skill 文件需要重启 Agent
  // 未来: 监听文件变化, fs.watch
}

// ─── 内部 ────────────────────────────────────

function formatSkillForLLM(s: Skill): string {
  return `# Skill: ${s.frontmatter.name}\n\n${s.body}`
}
```

## 4. load_skill 工具 (LLM 可调)

```typescript
// agent/src/skills/load-skill-tool.ts
// 把 load_skill 暴露成 LLM 能调的 tool (跟 MCP tools 平级)

import { Tool } from '@anthropic-ai/sdk/resources/messages/messages'
import { getSkillFullText } from './registry'

export const loadSkillTool: Tool = {
  name: 'load_skill',
  description: `加载指定 skill 的完整内容到当前对话上下文。
可用 skill 列表见 system prompt 中的 "Available Skills" 段。
调用时机: 当用户问题匹配某个 skill 的描述/触发词时, 先调本工具加载, 再按 skill 的工作流执行。`,
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'skill 的 name 字段 (e.g. "weekly-bank-review")',
      },
      reason: {
        type: 'string',
        description: '为什么加载这个 skill (用于审计)',
      },
    },
    required: ['name', 'reason'],
  },
}

// 在 AgentRunner 工具循环里, 特殊处理 load_skill
export function handleLoadSkill(args: { name: string; reason: string }): {
  skillName: string
  content: string
  bytesLoaded: number
} {
  const content = getSkillFullText(args.name)
  if (!content) {
    return {
      skillName: args.name,
      content: `ERROR: skill "${args.name}" not found. Available skills: ${[...registry.keys()].join(', ')}`,
      bytesLoaded: 0,
    }
  }
  return {
    skillName: args.name,
    content,
    bytesLoaded: content.length,
  }
}
```

**关键设计选择**:
- `load_skill` 跟 MCP tools 平级, 但**实现不在 MCP Bridge 里**, 而在 Agent 进程内
- 它的"工具结果"是 skill 全文, AgentRunner 拿到后**把它作为 system message 插入对话历史**, 让 LLM 后续能 reference

## 5. v1 的 5 个业务 Skill (文件示例)

### 5.1 agent/skills/weekly-bank-review.md

```markdown
---
name: weekly-bank-review
description: |
  周一早上的银行流水复盘。拉未分类 KPI, 按文件拆解, 对最大未分类文件
  跑 get_unclassified_transactions, 对每笔找现有规则候选, 对无候选的
  用 LLM 判断后 submit_proposal, 最后输出 markdown 报告。
triggers:
  - "周报"
  - "上周"
  - "周复盘"
  - "未分类处理建议"
---

# 周银行流水复盘

## 适用场景
- Cron 周一 9:00 自动触发
- 用户主动问"上周怎么样" / "周报" / "未分类还有多少"

## 工作流 (5 步)
1. `get_pipeline_kpi(brand=$current_brand)` — 拿上周 KPI 概览
2. `get_unclassified_by_file(limit=10, brand=$current_brand)` — 看是哪些文件拖累
3. 对 top-3 未分类文件, `get_unclassified_transactions(file_id, limit=50)` 拉明细
4. 对每笔未分类, `get_candidates(txn_id)` 看现有规则能否匹配
5. 对无候选的笔, 用 LLM 判断分类 + `submit_proposal` 提交 (单次 ≤ 20 条)

## 输出格式
- Markdown 报告
- 数字带千分位, 金额单位: 元
- 包含: 上周未分类笔数 / 总额 / 主要对手 Top-10 / 建议新增规则
- 不要重复输出"已分类"的数据, 用户已经看过了

## 注意事项
- 不要为了凑数提规则, 同对手出现 ≥ 3 次才建议
- 如果无候选, 先确认对方名称是否规范再判断, 不要看到"美团"就 INCOME_QIMAI
- 输出用中文
```

### 5.2 agent/skills/qimai-revenue-anomaly.md (示例)

```markdown
---
name: qimai-revenue-anomaly
description: |
  当用户问"为什么这个月收入下降"时加载。
  拉本月 vs 上月 Qimai 收入, 按 channel 拆解, 定位哪个 channel 异常。
triggers:
  - "收入下降"
  - "为什么少了"
  - "Qimai 异常"
  - "本月收入"
---

# Qimai 收入异常诊断

## 工作流
1. `query_qimai_revenue(period=this_month, span=month)` — 拿本月
2. `query_qimai_revenue(period=last_month, span=month)` — 拿上月
3. 算 channel-level delta, 找 top-3 异常 channel
4. 对异常 channel, 查 `query_gelatomiiix_income(channel=X, limit=20)` 看明细
5. 输出: "本月 vs 上月, 微信下降 15% (¥12,000), 主要因为周末订单 -30%"

## 注意
- 跟"经营"问题区分, 本 skill 只负责 Qimai 渠道
- 堂食/外卖问题用 store-report skill (v1 不做)
```

### 5.3-5.5 (简版)

- **monthly-financial-summary.md** — 月度财务总结, 调 query_financial_statement × 3 + counterparty + payment-metrics
- **bulk-propose-rules.md** — 批量提规则, 调 get_unclassified + get_candidates + submit_proposal (≤ 20 条/批)
- **cashflow-anomaly.md** — 现金流异常, 调 cashflow statement + counterparty

## 6. AgentRunner 怎么用 Skill Registry

```typescript
// agent/src/agent/runner.ts (片段)

import { listSkillDescriptions } from '../skills/registry'

function buildSystemPrompt(ctx: PageCtx, tools: ToolSchemaLite[]): string {
  const skillIndex = listSkillDescriptions()  // ~500 tokens, 常驻

  return `${header}

# Available Skills (调用 load_skill(name) 加载完整工作流)
${skillIndex}

# Tools
${toolList}

# Rules
${GENERAL_RULES}
${TOOL_USAGE}
${BANK_RULE}
${FINANCIAL_RATE_RULE}
${FORBIDDEN}`
}

// 在工具循环里, 特殊处理 load_skill
async function handleToolCall(toolCall: ToolUseBlock): Promise<ToolResultBlock> {
  if (toolCall.name === 'load_skill') {
    const result = handleLoadSkill(toolCall.input)
    // 记录到 conversation (audit)
    await conversation.appendSystem(`[Loaded skill: ${result.skillName}, ${result.bytesLoaded} bytes]`)
    return { type: 'tool_result', tool_use_id: toolCall.id, content: result.content }
  }
  // 其他 tool → 走 MCP Bridge
  return mcpBridge.call(toolCall.name, toolCall.input)
}
```

**关键流程**:
1. 启动时 `initRegistry()` 把 5 个 skill 加载到内存
2. `buildSystemPrompt` 把 `listSkillDescriptions()` 拼进去 (~500 tokens)
3. LLM 看到 description 列表, 觉得需要就调 `load_skill('weekly-bank-review')`
4. `handleToolCall` 识别 `load_skill`, 返回 skill 全文
5. LLM 拿到全文, 按 skill 的工作流调其他 MCP tools

## 7. v0 字符串 vs v1 .md 文件 对比

```
v0: ui/src/lib/chat/prompt.ts 第 50-71 行                  v1: agent/skills/*.md

const TOOL_USAGE_CONVENTIONS = `                           ---
- Before calling get_brand_stores                         name: wdg-data-platform
  for a specific brand, double-check...                   description: ...
- For "this month" ...                                    ---
- For bank classification proposals: ...
`                                                          # wdg-data-platform

const BANK_RULE = `                                        ---
- in_amt > 0 (money in)                                   name: bank-classification
  → only REV_BIZ or REV_OTHER                             description: ...
- out_amt > 0 (money out)                                 ---
  → only EXP_* categories
- Never classify 退款 as expense ...                      # Bank Classification
`                                                          - in_amt > 0 ...
                                                           ...
```

**文字内容一字不动**, 只是从 TypeScript 字符串字面量变成 .md 文件 + YAML frontmatter。
- 1 个字符串 → 1 个 .md (e.g. `BANK_RULE` → `bank-classification.md`)
- 内容 100% 保留, 可在 git 里 diff 验证

## 8. 这个组件你看什么

- **Y 方案的"description 常驻 + load 展开"** 在 v1 落地具体是这样
- **load_skill 是个特殊 tool**, 不走 MCP, 在 AgentRunner 里直接处理
- **v0 字符串 → v1 .md 是纯内容搬家**, 文字不动
- **新加 skill = 新加 1 个 .md 文件**, 不改代码 (LLM 启动时自动扫)
- **v1 5 个 skill = 4 个"基线 skill" + 1 个"周报 skill"** (基线从 prompt.ts 抽出, 周报是新增业务)
