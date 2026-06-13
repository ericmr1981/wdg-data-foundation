// agent/src/skills/loader.ts
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import matter from 'gray-matter'
import type { Skill, SkillFrontmatter } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getSkillsDir(): string {
  // agent/skills/ 跟 src/skills/ 平级
  return process.env.SKILLS_DIR ?? join(__dirname, '..', '..', 'skills')
}

export function loadAllSkills(): Skill[] {
  const dir = getSkillsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  return files.map(f => loadOneSkill(join(dir, f))).filter(Boolean) as Skill[]
}

export function loadOneSkill(path: string): Skill | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as SkillFrontmatter

    if (!fm.name || !fm.description) {
      console.warn(`[skills] ${path}: missing name or description, skip`)
      return null
    }

    // disabled 字段: 留 .md 文件 (UI 仍可看), 但 agent 不加载 (不注入 LLM 列表)
    if (fm.disabled === true) {
      console.log(`[skills] ${path}: disabled by frontmatter, skipping load`)
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
