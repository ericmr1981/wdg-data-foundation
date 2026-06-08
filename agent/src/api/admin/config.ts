// agent/src/api/admin/config.ts
import type { FastifyInstance } from 'fastify'
import {
  getAgentConfig, setAgentMd, setParams, setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS,
} from '../../config/store.js'
import { writeFileSync } from 'fs'
import { AGENT_MD_FILE_PATH } from '../../config/agent-md-loader.js'

export function registerAdminConfigRoutes(app: FastifyInstance) {
  // 鉴权: 仅 admin
  app.addHook('preHandler', async (req, reply) => {
    const role = req.headers['x-wdg-user-role']
    if (role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
  })

  app.get('/api/admin/config', async () => {
    const cfg = getAgentConfig()
    return {
      success: true,
      agentMdContent: cfg.agentMd,
      params: cfg.params,
      defaultParams: DEFAULT_PARAMS,
      model: cfg.model,
      hasApiKey: cfg.apiKey !== null,
      dirty: false,
    }
  })

  app.post<{ Body: { agentMd?: string; params?: any; credentials?: any } }>('/api/admin/config', async (req) => {
    const { agentMd, params, credentials } = req.body

    if (agentMd !== undefined) {
      setAgentMd(agentMd)
      try { writeFileSync(AGENT_MD_FILE_PATH, agentMd, 'utf-8') } catch (e) {
        console.error('[admin/config] write agent.md failed:', e)
      }
    }
    if (params) setParams(params)
    if (credentials) setCredentialConfig(credentials.baseURL, credentials.apiKey, credentials.model)

    return { success: true, message: 'config updated' }
  })

  app.post('/api/admin/config/reset', async () => {
    resetAgentConfig()
    return { success: true }
  })
}
