import { verifyAgentToken } from '../channels/auth.js';
import { reconstructContentBlocks } from '../conversation/content-blocks.js';
async function getUserId(req) {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        try {
            const claims = await verifyAgentToken(auth.slice(7));
            return claims.sub ?? null;
        }
        catch {
            return null;
        }
    }
    return null;
}
export function registerConversationRoutes(app, conversation) {
    // 鉴权: 所有路由都需要 Bearer JWT
    app.addHook('preHandler', async (req, reply) => {
        if (!req.url.startsWith('/api/conversations'))
            return;
        const uid = await getUserId(req);
        if (!uid)
            return reply.code(401).send({ error: 'unauthorized' });
        req.userId = uid;
    });
    // GET /api/conversations  → listByUser
    app.get('/api/conversations', async (req) => {
        const uid = req.userId;
        const list = await conversation.listByUser(uid, 50);
        return list;
    });
    // POST /api/conversations  → create empty
    app.post('/api/conversations', async (req, reply) => {
        const uid = req.userId;
        const brand = typeof req.body?.brand === 'string' ? req.body.brand : null;
        const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
        const created = await conversation.createEmpty(uid, brand, title);
        reply.code(201);
        return {
            id: created.conversationId,
            brand,
            title: created.title,
            createdAt: new Date().toISOString(),
        };
    });
    // PATCH /api/conversations/:id  → rename
    app.patch('/api/conversations/:id', async (req, reply) => {
        const uid = req.userId;
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        if (!title)
            return reply.code(400).send({ error: 'title_required' });
        const ok = await conversation.rename(req.params.id, uid, title);
        if (!ok)
            return reply.code(403).send({ error: 'forbidden' });
        reply.code(200);
        return { id: req.params.id, title, updated_at: new Date().toISOString() };
    });
    // DELETE /api/conversations/:id  → archive
    app.delete('/api/conversations/:id', async (req, reply) => {
        const uid = req.userId;
        const ok = await conversation.archive(req.params.id, uid);
        if (!ok)
            return reply.code(403).send({ error: 'forbidden' });
        reply.code(204);
        return null;
    });
    // GET /api/conversations/:id/messages  → history
    app.get('/api/conversations/:id/messages', async (req, reply) => {
        const uid = req.userId;
        const owns = await conversation.getOne(req.params.id, uid);
        if (!owns)
            return reply.code(403).send({ error: 'forbidden' });
        const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
        const msgs = await conversation.getMessages(req.params.id, limit);
        return msgs.map((m) => ({
            messageId: `msg_${m.messageId}`,
            role: m.role,
            content: reconstructContentBlocks({
                content: m.content,
                tool_calls: m.toolCalls,
                tool_results: m.toolResults,
                thinking: m.thinking,
            }),
            status: 'done',
            stop_reason: m.stop_reason ?? 'end_turn',
            usage: m.usage ?? null,
            createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
        }));
    });
}
