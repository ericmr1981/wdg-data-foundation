// agent/src/agent/prompt.ts
import { listSkillDescriptions, getSkillFullText } from '../skills/registry'
import type Anthropic from '@anthropic-ai/sdk'
import { loadSkillTool } from '../skills/load-skill-tool'

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
