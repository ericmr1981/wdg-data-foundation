// agent/src/agent/prompt.ts
import { listSkillDescriptions, getSkillFullText } from '../skills/registry.js'
import type Anthropic from '@anthropic-ai/sdk'
import { loadSkillTool } from '../skills/load-skill-tool.js'

export interface PageCtx {
  brand?: string | null
  channel?: string
  conversationId?: string | null
}

export function buildSystemPrompt(
  ctx: PageCtx,
  agentMd: string,
  tools: Anthropic.Tool[],
): string {
  const today = new Date().toISOString().slice(0, 10)
  const skillIndex = listSkillDescriptions()
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
  const forbidden = getSkillFullText('forbidden-shortcuts') ?? ''

  return `${agentMd}

# Today
${today}

# Current Context
brand=${ctx.brand ?? '<none>'}, channel=${ctx.channel ?? 'web'}

# Available Skills
调用 load_skill(name) 加载完整工作流:
${skillIndex}

# Tools (${tools.length})
${toolList}

# General Rules
- Use tools. Don't make up numbers.
- 中文回答
- 调 load_skill 后, 按 skill 的工作流执行

${forbidden}`
}

// ─── R4: system blocks + session context (for toolRunner / prompt caching) ───

const AGENT_MD_CACHE_CONTROL: Anthropic.CacheControlEphemeral = {
  type: 'ephemeral',
  ttl: '1h',
}

/**
 * Stable system content as a single cache-eligible text block.
 * The first (and only) block carries cache_control ttl=1h so prompt caching
 * kicks in across turns. Volatile per-turn context does NOT live here —
 * it goes into the first user message via buildSessionContextMessage.
 */
export function buildSystemBlocks(agentMd: string): Anthropic.TextBlockParam[] {
  return [{
    type: 'text',
    text: agentMd,
    cache_control: AGENT_MD_CACHE_CONTROL,
  }]
}

/**
 * Per-turn session context, injected into the first user message (not system),
 * so it never invalidates the cached system block.
 */
export function buildSessionContextMessage(ctx: {
  today: string; brand: string | null; conversationId: string; channel: string;
}): string {
  return `# Session Context (auto-injected, do not mention to user)
today: ${ctx.today}
brand: ${ctx.brand ?? '<none>'}
channel: ${ctx.channel}
conversationId: ${ctx.conversationId}
`
}
