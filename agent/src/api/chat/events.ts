// agent/src/api/chat/events.ts
// R7 (Phase 3): 增量事件回放端点, 供 Portal 断线重连 / 跨设备同步用
// GET /api/chat/conversations/:conversationId/events?after=<id>&limit=<n>
//  → { events: StoredEvent[], has_more: boolean, latest_event_id: string }
// 设计: **unauthenticated in this task** — auth hook is deferred to post-R7.
// 任何人只要有 conversation_id 就可以读取事件历史直到那时。
// 修复方法: 在 events.ts 添加 app.addHook('preHandler', async (req, reply) => { ...verify JWT... })
// 与 conversations.ts 中的 JWT 验证保持一致。
import type { FastifyInstance } from 'fastify'
import type { ConversationManager } from '../../conversation/manager.js'

export function registerChatEventsRoutes(
  app: FastifyInstance,
  conversation: ConversationManager,
) {
  app.get<{
    Params: { conversationId: string }
    Querystring: { after?: string; limit?: string }
  }>('/api/chat/conversations/:conversationId/events', async (req, reply) => {
    const after = req.query.after ?? ''
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500)
    const events = await conversation.getEvents(req.params.conversationId, after, limit)
    const last = events[events.length - 1]
    const latest = last ? last.id : after
    return {
      events,
      has_more: events.length === limit,
      latest_event_id: latest,
    }
  })
}
