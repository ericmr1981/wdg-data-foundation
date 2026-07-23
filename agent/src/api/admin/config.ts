// agent/src/api/admin/config.ts
// Admin config endpoints — Phase R (DB as sole source).
//
// GET:  返回全量 config (in-memory 缓存)
// POST: 写 in-memory + 写 DB (persistent)
// /reset:  清空 credentials (api_key=null, base_url=null), model 复位
// /reload: 从 DB 重读

import type { FastifyInstance } from 'fastify'
import {
  getAgentConfig, setAgentMd, setParams, setCredentialConfig, setJwksUrl, setMcpBackends,
  resetAgentConfig, DEFAULT_PARAMS, reloadFromDb, getConfigSource,
  type AgentConfigParams,
} from '../../config/store.js'
import { encrypt } from '../../crypto/secret-crypto.js'
import { writeFileSync } from 'fs'
import { AGENT_MD_FILE_PATH } from '../../config/agent-md-loader.js'
import { getPool } from '../../db.js'
import type { BackendConfig } from '../../mcp/bridge.js'

/**
 * 取一段 raw token 的末 4 字符用于 mask 显示。
 * - 空 / null → null(从未配置)
 * - 非空 → '***' + last4
 */
function maskLast4(raw: string | null | undefined): string | null {
  if (!raw) return null
  return `***${raw.slice(-4)}`
}

export function registerAdminConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin/')) return
    const role = req.headers['x-wdg-user-role']
    if (role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
  })

  // ─── GET ──────────────────────────────
  app.get('/api/admin/config', async () => {
    const cfg = getAgentConfig()
    // UI 视角下,每个 backend 名对应 mask 后的 token 状态(末 4 位);
    // 显示哪些 backend 已配 token,用于 placeholder 提示。
    const mcpBackendTokensMasked: Record<string, string | null> = {}
    for (const b of cfg.mcpBackends) {
      const encToken = cfg.mcpBackendTokens[b.name]
      // 末 4 字符需要从明文算 — 加 token-only 用法,只对已有加密 token 返回 mask
      // 这里我们没办法不解密就拿末 4,简单起见只返回 "已配置 / 未配置" 标记,具体末 4 由 UI 在提交时记录
      mcpBackendTokensMasked[b.name] = encToken ? '已配置' : null
    }
    return {
      success: true,
      agentMdContent: cfg.agentMd,
      params: cfg.params,
      defaultParams: DEFAULT_PARAMS,
      model: cfg.model,
      baseUrl: cfg.baseURL,
      hasApiKey: cfg.apiKey !== null,
      jwksUrl: cfg.jwksUrl,
      mcpBackends: cfg.mcpBackends,
      // Masked token 状态:{ backend_name: '已配置' | null }
      mcpBackendTokensMasked,
      // 总数给 UI 显示 "N 个后端已配置(从 DB 加载)"
      mcpBackendTokensCount: Object.keys(cfg.mcpBackendTokens).length,
      dirty: false,
      source: getConfigSource(),
    }
  })

  // ─── POST (upsert config into DB) ───────
  app.post<{
    Body: {
      agentMd?: string
      params?: Partial<AgentConfigParams>
      credentials?: { baseURL?: string | null; apiKey?: string | null; model?: string }
      jwksUrl?: string | null
      mcpBackends?: BackendConfig[]
      /**
       * 新增:外部 MCP backend 的 raw Bearer tokens(明文只在传输层存在)。
       * key = backend.name,value = raw token 字符串(不含 'Bearer ' 前缀)。
       * 不会写明文到 DB;后端会 AES-256-GCM 加密后存入 mcp_backend_tokens 列。
       * undefined value = 保留 DB 现存 token,删除请传 '__DELETE__' 哨兵。 */
      mcpBackendTokens?: Record<string, string>
    }
  }>('/api/admin/config', async (req, reply) => {
    const { agentMd, params, credentials, jwksUrl, mcpBackends, mcpBackendTokens } = req.body

    const oldCfg = getAgentConfig()

    // 0. 校验:mcpBackends[i].headers 里不允许出现 Authorization
    // Authorization 必须通过 mcpBackendTokens[name] 走加密通道,防止明文 JSON 透传到 DB
    if (Array.isArray(mcpBackends)) {
      for (const b of mcpBackends) {
        const hdrs = b.headers ?? {}
        for (const k of Object.keys(hdrs)) {
          if (k.toLowerCase() === 'authorization') {
            return reply.code(400).send({
              success: false,
              error: `mcpBackends[${b.name}].headers.${k} 不允许直接编辑。` +
                `请通过 'mcpBackendTokens["${b.name}"]' 字段以加密形式提交,` +
                `或在 DailyCheck UI (http://dailycheck:8080/admin/agent-tokens) 重新生成 token。`,
            })
          }
        }
      }
    }

    // 1. 计算新值（部分提交语义）
    let newApiKey: string | null | undefined = undefined
    let newBaseURL: string | null | undefined = undefined
    let newModel: string | undefined = undefined

    if (credentials) {
      if (credentials.hasOwnProperty('apiKey')) {
        newApiKey = credentials.apiKey ?? null
      }
      if (credentials.hasOwnProperty('baseURL')) {
        newBaseURL = credentials.baseURL ?? null
      }
      if (credentials.hasOwnProperty('model') && credentials.model) {
        newModel = credentials.model
      }
    }

    // 2. 写 in-memory (立即生效)
    if (agentMd !== undefined) {
      setAgentMd(agentMd)
      try { writeFileSync(AGENT_MD_FILE_PATH, agentMd, 'utf-8') } catch (e) {
        console.error('[admin/config] write agent.md failed:', e)
      }
    }
    if (params) setParams(params)
    if (credentials) {
      // 合并 in-memory: 用提交的值 or in-memory 旧值
      const finalBaseURL = newBaseURL !== undefined ? newBaseURL : oldCfg.baseURL
      const finalApiKey = newApiKey !== undefined ? newApiKey : oldCfg.apiKey
      const finalModel = newModel ?? oldCfg.model ?? 'claude-opus-4-8'
      setCredentialConfig(finalBaseURL, finalApiKey, finalModel)
    }
    if (jwksUrl !== undefined) {
      setJwksUrl(jwksUrl)
    }
    if (mcpBackends !== undefined) {
      // 防御:即使用户绕过 GET/POST 校验直接调用了 setMcpBackends,
      // 这里仍然剥离 Authorization,运行时只从 mcpBackendTokens 注入
      const sanitized = mcpBackends.map(b => {
        if (!b.headers) return b
        const cleaned: Record<string, string> = {}
        for (const [k, v] of Object.entries(b.headers)) {
          if (k.toLowerCase() !== 'authorization') cleaned[k] = v
        }
        return { ...b, headers: cleaned }
      })
      setMcpBackends(sanitized)
    }

    const newCfg = getAgentConfig()

    // 3. 写 DB (持久化)
    const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY
    if (!encKey) {
      console.warn('[admin/config] AGENT_CRED_ENCRYPTION_KEY env not set — DB write skipped')
      return { success: false, error: 'server misconfigured: AGENT_CRED_ENCRYPTION_KEY not set' }
    } else {
      try {
        const updated_by = String(req.headers['x-wdg-user-id'] ?? 'unknown')

        // 加密 apiKey: 只有当 POST body 里给了 apiKey 才写,否则保留 DB 原值
        let dbEncryptedKey: string | null = null
        if (newApiKey !== undefined) {
          dbEncryptedKey = newApiKey ? encrypt(newApiKey, encKey) : null
        }
        const dbBaseUrl = newBaseURL !== undefined ? newBaseURL : oldCfg.baseURL
        const dbModel = newModel ?? newCfg.model
        const dbJwksUrl = jwksUrl !== undefined ? jwksUrl : oldCfg.jwksUrl

        // 计算 dbMcpBackends:复用 mcp_backends 列,但剥掉 Authorization(防止历史污染写入生效)
        const rawDbBackends = mcpBackends !== undefined ? mcpBackends : oldCfg.mcpBackends
        const sanitizedDbBackends = rawDbBackends.map(b => {
          if (!b.headers) return b
          const cleaned: Record<string, string> = {}
          for (const [k, v] of Object.entries(b.headers)) {
            if (k.toLowerCase() !== 'authorization') cleaned[k] = v
          }
          return { ...b, headers: cleaned }
        })
        const dbMcpBackends = JSON.stringify(sanitizedDbBackends)

        // 加密 mcpBackendTokens:
        // - raw 不为空字符串 → encrypt 后覆盖
        // - 哨兵 '__DELETE__' → 删除该 backend 的 token
        // - 不在 body → 保留 DB 原值
        const dbMcpBackendTokensMap: Record<string, string> = { ...oldCfg.mcpBackendTokens }
        if (mcpBackendTokens && typeof mcpBackendTokens === 'object') {
          for (const [name, raw] of Object.entries(mcpBackendTokens)) {
            if (raw === '__DELETE__') {
              delete dbMcpBackendTokensMap[name]
              continue
            }
            if (typeof raw === 'string' && raw.length > 0) {
              dbMcpBackendTokensMap[name] = encrypt(raw, encKey)
            }
          }
        }
        const dbMcpBackendTokens = JSON.stringify(dbMcpBackendTokensMap)

        const upsertSql = `
          INSERT INTO agent.config (id, base_url, encrypted_key, model, params, agent_md, jwks_url, mcp_backends, mcp_backend_tokens, updated_at, updated_by)
          VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
          ON CONFLICT (id) DO UPDATE SET
            base_url    = COALESCE(EXCLUDED.base_url, agent.config.base_url),
            encrypted_key = COALESCE(EXCLUDED.encrypted_key, agent.config.encrypted_key),
            model       = EXCLUDED.model,
            params      = EXCLUDED.params,
            agent_md    = EXCLUDED.agent_md,
            jwks_url    = EXCLUDED.jwks_url,
            mcp_backends = EXCLUDED.mcp_backends,
            mcp_backend_tokens = EXCLUDED.mcp_backend_tokens,
            updated_at  = NOW(),
            updated_by  = EXCLUDED.updated_by
        `
        await getPool().query(upsertSql, [
          dbBaseUrl,
          dbEncryptedKey,
          dbModel,
          JSON.stringify(newCfg.params),
          newCfg.agentMd,
          dbJwksUrl,
          dbMcpBackends,
          dbMcpBackendTokens,
          updated_by,
        ])
        console.log(
          `[admin/config] DB saved: baseUrl=${dbBaseUrl} model=${dbModel} ` +
          `hasKey=${dbEncryptedKey !== null} backends=${rawDbBackends.length} ` +
          `tokens=${Object.keys(dbMcpBackendTokensMap).length}`,
        )
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

  // ─── POST /restart (让 systemd 重启 Agent) ─────
  // 退出前先 reload from DB，确保重启时拿到最新 DB 配置
  app.post('/api/admin/restart', async (_req, reply) => {
    await reloadFromDb()
    await reply.code(202).send({ success: true, message: 'restarting...' })
    console.log('[admin/config] restart triggered by admin')
    process.exit(0)
  })
}
