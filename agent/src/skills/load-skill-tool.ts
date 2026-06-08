// agent/src/skills/load-skill-tool.ts
// load_skill 作为 LLM 工具 — AgentRunner 特殊处理 (不走 MCP)

import type Anthropic from '@anthropic-ai/sdk'
import { getSkillFullText, listSkillNames } from './registry.js'

export const LOAD_SKILL_NAME = 'load_skill'

export const loadSkillTool: Anthropic.Tool = {
  name: LOAD_SKILL_NAME,
  description: `加载指定 skill 的完整内容到当前对话上下文.
可用 skill 列表见 system prompt 的 "Available Skills" 段.
调用时机: 当用户问题匹配某个 skill 的描述/触发词时, 先调本工具加载, 再按 skill 的工作流执行.`,
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'skill 的 name 字段 (e.g. "weekly-bank-review")' },
      reason: { type: 'string', description: '为什么加载这个 skill (用于审计)' },
    },
    required: ['name', 'reason'],
  },
}

export interface LoadSkillResult {
  skillName: string
  content: string
  bytesLoaded: number
}

export function handleLoadSkill(args: { name: string; reason: string }): LoadSkillResult {
  const content = getSkillFullText(args.name)
  if (!content) {
    return {
      skillName: args.name,
      content: `ERROR: skill "${args.name}" not found. Available skills: ${listSkillNames().join(', ')}`,
      bytesLoaded: 0,
    }
  }
  return {
    skillName: args.name,
    content,
    bytesLoaded: content.length,
  }
}
