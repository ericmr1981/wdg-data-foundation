// agent/src/skills/registry.ts
import type { Skill } from './types.js'
import { loadAllSkills } from './loader.js'

const registry = new Map<string, Skill>()

export function initRegistry(): void {
  registry.clear()
  for (const s of loadAllSkills()) {
    if (registry.has(s.frontmatter.name)) {
      throw new Error(`[skills] duplicate name: ${s.frontmatter.name}`)
    }
    registry.set(s.frontmatter.name, s)
  }
  console.log(`[skills] loaded ${registry.size} skills`)
}

export function listSkillDescriptions(): string {
  const skills = [...registry.values()]
  return skills
    .map(s => {
      const triggers = s.frontmatter.triggers?.length
        ? ` (触发词: ${s.frontmatter.triggers.join(', ')})`
        : ''
      return `· ${s.frontmatter.name}${triggers} — ${s.frontmatter.description.replace(/\n/g, ' ')}`
    })
    .join('\n')
}

export function getSkill(name: string): Skill | null {
  return registry.get(name) ?? null
}

export function getSkillFullText(name: string): string | null {
  const s = registry.get(name)
  return s ? formatSkillForLLM(s) : null
}

export function listSkillNames(): string[] {
  return [...registry.keys()]
}

function formatSkillForLLM(s: Skill): string {
  return `# Skill: ${s.frontmatter.name}\n\n${s.body}`
}
