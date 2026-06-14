// agent/src/skills/types.ts
export interface SkillFrontmatter {
  name: string
  description: string
  triggers?: string[]
  version?: string
}

export interface Skill {
  frontmatter: SkillFrontmatter
  body: string
  fullPath: string
  size: number
  loadedAt: Date
}
