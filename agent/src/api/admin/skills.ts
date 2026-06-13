// agent/src/api/admin/skills.ts
// Admin API: list / get / put / delete / create / reload skill markdown files.
import type { FastifyInstance } from 'fastify'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'
import { reloadSkill } from '../../skills/registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// agent/src/api/admin/skills.ts → ../../skills = agent/skills/
const SKILLS_DIR = process.env.SKILLS_DIR ?? join(__dirname, '..', '..', '..', 'skills')

function readDirSafe(): string[] {
  if (!existsSync(SKILLS_DIR)) return []
  return readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'))
}

function findFileByName(name: string): string | null {
  const files = readDirSafe()
  for (const f of files) {
    const raw = readFileSync(join(SKILLS_DIR, f), 'utf-8')
    const parsed = matter(raw)
    if (parsed.data.name === name) return f
  }
  return null
}

function listOne(filename: string) {
  const path = join(SKILLS_DIR, filename)
  const raw = readFileSync(path, 'utf-8')
  const parsed = matter(raw)
  const fm = parsed.data as { name?: string; description?: string; triggers?: string[] }
  const s = statSync(path)
  return {
    name: fm.name ?? filename.replace(/\.md$/, ''),
    description: fm.description ?? '',
    triggers: fm.triggers ?? [],
    filename,
    size: raw.length,
    body: parsed.content.trim(),
    modifiedAt: s.mtime.toISOString(),
  }
}

export function registerAdminSkillRoutes(app: FastifyInstance) {
  // 鉴权: 仅 admin
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin/')) return
    const role = req.headers['x-wdg-user-role']
    if (role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
  })

  // GET 列表
  app.get('/api/admin/skills', async () => {
    const skills = readDirSafe().map(listOne)
    return { success: true, skills }
  })

  // GET 单个
  app.get<{ Params: { name: string } }>('/api/admin/skills/:name', async (req, reply) => {
    const file = findFileByName(req.params.name)
    if (!file) return reply.code(404).send({ error: 'skill not found' })
    const path = join(SKILLS_DIR, file)
    const raw = readFileSync(path, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as { description?: string; triggers?: string[] }
    return {
      success: true,
      name: req.params.name,
      description: fm.description ?? '',
      triggers: fm.triggers ?? [],
      body: parsed.content.trim(),
      raw,
      filename: file,
    }
  })

  // PUT 更新
  app.put<{ Params: { name: string }; Body: { body: string } }>(
    '/api/admin/skills/:name',
    async (req, reply) => {
      const file = findFileByName(req.params.name)
      if (!file) return reply.code(404).send({ error: 'skill not found' })
      if (typeof req.body?.body !== 'string' || req.body.body.length === 0) {
        return reply.code(400).send({ error: 'body must be non-empty string' })
      }
      // 校验: 重写后 frontmatter.name 必须仍是原名
      try {
        const parsed = matter(req.body.body)
        const newName = parsed.data.name
        if (newName !== req.params.name) {
          return reply.code(400).send({ error: `frontmatter.name must remain "${req.params.name}", got "${newName}"` })
        }
        if (!parsed.data.description) {
          return reply.code(400).send({ error: 'frontmatter.description is required' })
        }
      } catch (e) {
        return reply.code(400).send({ error: 'yaml frontmatter parse failed: ' + (e as Error).message })
      }
      writeFileSync(join(SKILLS_DIR, file), req.body.body, 'utf-8')
      return { success: true, message: 'skill updated, call /reload to apply' }
    },
  )

  // POST 创建
  app.post<{ Body: { name: string } }>('/api/admin/skills', async (req, reply) => {
    const name = req.body?.name
    if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return reply.code(400).send({ error: 'name must match /^[a-z0-9][a-z0-9-]*$/' })
    }
    if (findFileByName(name)) {
      return reply.code(409).send({ error: `skill "${name}" already exists` })
    }
    if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true })
    const filename = `${name}.md`
    const template = `---\nname: ${name}\ndescription: |\n  TODO: 描述这个 skill 的用途.\ntriggers:\n  - "${name}"\n---\n\n# ${name}\n\nTODO: 在这里写 skill 的具体内容.\n`
    try {
      writeFileSync(join(SKILLS_DIR, filename), template, 'utf-8')
    } catch (e) {
      return reply.code(500).send({ error: 'write_failed', message: (e as Error).message })
    }
    return { success: true, filename, message: 'skill created, please fill content and call /reload' }
  })

  // DELETE 删除
  app.delete<{ Params: { name: string } }>('/api/admin/skills/:name', async (req, reply) => {
    const file = findFileByName(req.params.name)
    if (!file) return reply.code(404).send({ error: 'skill not found' })
    unlinkSync(join(SKILLS_DIR, file))
    return { success: true, message: 'skill deleted, call /reload to apply' }
  })

  // POST reload
  app.post('/api/admin/skills/reload', async (req, reply) => {
    try {
      reloadSkill('all')
      return { success: true, message: `skills reloaded. count=${listDirCount()}` }
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message })
    }
  })
}

function listDirCount(): number {
  return readDirSafe().length
}
