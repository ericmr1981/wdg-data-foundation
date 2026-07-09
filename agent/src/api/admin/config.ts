// agent/src/api/admin/config.ts
// Admin config endpoints — Phase 1 升级:
// - GET 同时返回 source (db/env/default) 给 UI 提示
// - POST 写 DB (UPSERT),key 用 AGENT_CRED_ENCRYPTION_KEY 加密
// - 重置按钮改成 "回退到 env" 而不是 "default",避免误删 DB 数据
import type { FastifyInstance } from 'fastify'
import {
  getAgentConfig, setAgentMd, setParams, setCredentialConfig,
  resetAgentConfig, DEFAULT_PARAMS, reloadFromDb, getConfigSource,
  type AgentConfigParams,
} from '../../config/store.js'
import { encrypt } from '../../crypto/secret-crypto.js'
import { writeFileSync } from 'fs'
import { AGENT_MD_FILE_PATH } from '../../config/agent-md-loader.js'
import { getPool } from '../../db.js'

export function registerAdminConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin/')) return
    const role = req.headers['x-wdg-user-role']
    if (role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
  })

  // ─── GET ──────────────────────────────
  app.get('/api/admin/config', async () => {
    const cfg = getAgentConfig()
    return {
      success: true,
      agentMdContent: cfg.agentMd,
      params: cfg.params,
      defaultParams: DEFAULT_PARAMS,
      model: cfg.model,
      baseUrl: cfg.baseURL,
      hasApiKey: cfg.apiKey !== null,
      dirty: false,
      source: getConfigSource(),  // 'db' | 'env' | 'default'
    }
  })

  // ─── POST (upsert config into DB) ───────
  app.post<{
    Body: {
      agentMd?: string
      params?: Partial<AgentConfigParams>
      credentials?: { baseURL?: string | null; apiKey?: string | null; model?: string }
    }
  }>('/api/admin/config', async (req) => {
    const { agentMd, params, credentials } = req.body

    // 1. 写 in-memory (立即生效)
    const oldCfg = getAgentConfig()
    if (agentMd !== undefined) {
      setAgentMd(agentMd)
      try {
        writeFileSync(AGENT_MD_FILE_PATH, agentMd, 'utf-8')
      } catch (e) {
        console.error('[admin/config] write agent.md failed:', e)
      }
    }
    if (params) setParams(params)
    if (credentials) {
      setCredentialConfig(
        credentials.baseURL ?? null,
        credentials.apiKey ?? null,
        credentials.model ?? oldCfg.model ?? 'claude-opus-4-8',
      )
    }
    const newCfg = getAgentConfig()

    // 2. 写 DB (持久化)
    const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY
    if (!encKey) {
      console.warn('[admin/config] AGENT_CRED_ENCRYPTION_KEY env not set — DB write skipped')
    } else {
      try {
        const updated_by = String(req.headers['x-wdg-user-id'] ?? 'unknown')
        // 加密 apiKey (如果提交了); 否则保留旧值
        let encryptedKey: string | null = null
        if (credentials && credentials.apiKey) {
          encryptedKey = encrypt(credentials.apiKey, encKey)
        }
        const baseUrl = credentials?.baseURL ?? newCfg.baseURL
        const model = credentials?.model ?? newCfg.model

        const upsertSql = `
          INSERT INTO agent.config (id, base_url, encrypted_key, model, params, agent_md, updated_at, updated_by)
          VALUES (1, $1, COALESCE($2, (SELECT encrypted_key FROM agent.config WHERE id = 1)),
                  $3, $4, $5, NOW(), $6)
          ON CONFLICT (id) DO UPDATE SET
            base_url    = EXCLUDED.base_url,
            encrypted_key = COALESCE(EXCLUDED.encrypted_key, agent.config.encrypted_key),
            model       = EXCLUDED.model,
            params      = EXCLUDED.params,
            agent_md    = EXCLUDED.agent_md,
            updated_at  = NOW(),
            updated_by  = EXCLUDED.updated_by
        `
        await getPool().query(upsertSql, [
          baseUrl,
          encryptedKey,
          model,
          JSON.stringify(newCfg.params),
          newCfg.agentMd,
          updated_by,
        ])
      } catch (e) {
        console.error('[admin/config] DB write failed:', (e as Error).message)
        return { success: false, error: 'DB write failed (in-memory change kept)' }
      }
    }

    return { success: true, message: 'config updated' }
  })

  // ─── POST /reset (回退到 env) ─────
  app.post('/api/admin/config/reset', async () => {
    resetAgentConfig()
    // DB 不删,但 cache 重置成 default; UI 改需要重新 init
    return { success: true, message: 'in-memory reset (DB row untouched)' }
  })

  // ─── POST /reload (从 DB 重新读) ─────
  app.post('/api/admin/config/reload', async () => {
    const cfg = await reloadFromDb()
    return {
      success: !!cfg,
      source: cfg?.source ?? null,
      message: cfg ? 'reloaded from DB' : 'no DB row found',
    }
  })
}

