// agent/src/api/conversations.ts
// user-facing SDK routes for portal — list/create/rename/archive + messages history
import type { FastifyInstance } from 'fastify'
import { verifyAgentToken } from '../channels/auth.js'
import type { ConversationManager } from '../conversation/manager.js'
import { reconstructContentBlocks } from '../conversation/content-blocks.js'

async function getUserId(req: any): Promise<string | null> {
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    try {
      const claims = await verifyAgentToken(auth.slice(7))
      return claims.sub ?? null
    } catch {
      return null
    }
  }
  return null
}

export function registerConversationRoutes(app: FastifyInstance, conversation: ConversationManager) {
  // 鉴权: 所有路由都需要 Bearer JWT
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/conversations')) return
    const uid = await getUserId(req)
    if (!uid) return reply.code(401).send({ error: 'unauthorized' })
    ;(req as any).userId = uid
  })

  // GET /api/conversations  → listByUser
  app.get('/api/conversations', async (req) => {
    const uid = (req as any).userId
    const list = await conversation.listByUser(uid, 50)
    return list
  })

  // POST /api/conversations  → create empty
  app.post<{ Body: { brand?: string | null; title?: string } }>('/api/conversations', async (req, reply) => {
    const uid = (req as any).userId
    const brand = typeof req.body?.brand === 'string' ? req.body.brand : null
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined
    const created = await conversation.createEmpty(uid, brand, title)
    reply.code(201)
    return {
      id: created.conversationId,
      brand,
      title: created.title,
      createdAt: new Date().toISOString(),
    }
  })

  // PATCH /api/conversations/:id  → rename
  app.patch<{ Params: { id: string }; Body: { title: string } }>('/api/conversations/:id', async (req, reply) => {
    const uid = (req as any).userId
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    if (!title) return reply.code(400).send({ error: 'title_required' })
    const ok = await conversation.rename(req.params.id, uid, title)
    if (!ok) return reply.code(403).send({ error: 'forbidden' })
    reply.code(200)
    return { id: req.params.id, title, updated_at: new Date().toISOString() }
  })

  // DELETE /api/conversations/:id  → archive
  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const uid = (req as any).userId
    const ok = await conversation.archive(req.params.id, uid)
    if (!ok) return reply.code(403).send({ error: 'forbidden' })
    reply.code(204)
    return null
  })

  // GET /api/conversations/:id/messages  → history
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/conversations/:id/messages',
    async (req, reply) => {
      const uid = (req as any).userId
      const owns = await conversation.getOne(req.params.id, uid)
      if (!owns) return reply.code(403).send({ error: 'forbidden' })
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500)
      const msgs = await conversation.getMessages(req.params.id, limit)
      return msgs.map((m) => ({
        messageId: `msg_${m.messageId}`,
        role: m.role,
        content: reconstructContentBlocks({
          content: m.content,
          tool_calls: (m as any).toolCalls,
          tool_results: (m as any).toolResults,
          thinking: (m as any).thinking,
        }),
        status: 'done',
        stop_reason: (m as any).stop_reason ?? 'end_turn',
        usage: (m as any).usage ?? null,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      }))
    },
  )
}
