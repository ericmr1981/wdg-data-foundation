// agent/src/conversation/manager.ts
// 短期记忆: conversation 生命周期 + LLM 压缩
// getOrCreate / appendMessage / getMessages / maybeCompress (滑动窗口)
//
// R7 (Phase 3) follow-up:
//   - anthropic 不再由 ConversationManager 持有(压缩改在 server 启动时由
//     caller 注入 llm 的 LlmSummarizer);ConversationManager 只负责 DB I/O。
//   - recordEvent / getEvents — agent.message_events 表 replay 端点用
//     (id 形如 'evt_<base36ts>_<rand6>' 时间序排序,idx_message_events_conv_id
//     让 (conversation_id, id) 范围扫命中)。
export class ConversationManager {
    db;
    summarizer;
    windowSize;
    constructor(db, summarizer = null, windowSize = 10) {
        this.db = db;
        this.summarizer = summarizer;
        this.windowSize = windowSize;
    }
    async getOrCreate(msg) {
        if (msg.conversationId) {
            // try UPDATE first — 如果 conversationId 不是有效 UUID,PostgreSQL 会抛 22P02,
            // catch 后 fall through 到 INSERT
            try {
                const { rowCount } = await this.db.query(`UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`, [msg.conversationId]);
                if (rowCount && rowCount > 0)
                    return { conversationId: msg.conversationId };
            }
            catch {
                // 非 UUID 或不存在:走 INSERT
            }
        }
        const { rows } = await this.db.query(`
      INSERT INTO agent.conversations (user_id, brand, channel_id)
      VALUES ($1, $2, $3)
      RETURNING conversation_id
    `, [msg.userId, msg.brand, msg.channelId]);
        return { conversationId: rows[0].conversation_id };
    }
    async getMessages(conversationId, limit) {
        const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id DESC
      LIMIT $2
    `, [conversationId, limit]);
        return rows.reverse().map((r) => ({
            messageId: r.message_id,
            role: r.role,
            content: r.content,
            toolCalls: r.tool_calls,
            toolResults: r.tool_results,
            thinking: r.thinking,
            createdAt: r.created_at,
        }));
    }
    async getSummary(conversationId) {
        const { rows } = await this.db.query(`SELECT summary FROM agent.conversations WHERE conversation_id = $1`, [conversationId]);
        return rows[0]?.summary ?? '';
    }
    async appendMessage(msg) {
        await this.db.query(`
      INSERT INTO agent.messages (conversation_id, role, content, tool_calls, tool_results, thinking)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
            msg.conversationId, msg.role, msg.content,
            msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            msg.toolResults ? JSON.stringify(msg.toolResults) : null,
            msg.thinking ?? null,
        ]);
        await this.db.query(`UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`, [msg.conversationId]);
    }
    async listByUser(userId, limit = 50) {
        const { rows } = await this.db.query(`
      SELECT conversation_id, brand, title, status, created_at, last_active_at
      FROM agent.conversations
      WHERE user_id = $1 AND status = 'active'
      ORDER BY last_active_at DESC
      LIMIT $2
    `, [userId, limit]);
        return rows.map((r) => ({
            conversationId: r.conversation_id,
            brand: r.brand,
            title: r.title,
            status: r.status,
            createdAt: r.created_at,
            lastActiveAt: r.last_active_at,
        }));
    }
    async getOne(conversationId, userId) {
        const { rows } = await this.db.query(`
      SELECT conversation_id, brand, title, status, created_at, last_active_at
      FROM agent.conversations
      WHERE conversation_id = $1 AND user_id = $2
    `, [conversationId, userId]);
        if (rows.length === 0)
            return null;
        const r = rows[0];
        return {
            conversationId: r.conversation_id,
            brand: r.brand,
            title: r.title,
            status: r.status,
            createdAt: r.created_at,
            lastActiveAt: r.last_active_at,
        };
    }
    async createEmpty(userId, brand, title) {
        const { rows } = await this.db.query(`
      INSERT INTO agent.conversations (user_id, brand, channel_id, title)
      VALUES ($1, $2, 'web', $3)
      RETURNING conversation_id, title
    `, [userId, brand, title ?? '新会话']);
        return { conversationId: rows[0].conversation_id, title: rows[0].title };
    }
    async rename(conversationId, userId, title) {
        const { rowCount } = await this.db.query(`
      UPDATE agent.conversations
      SET title = $3, last_active_at = NOW()
      WHERE conversation_id = $1 AND user_id = $2
    `, [conversationId, userId, title]);
        return (rowCount ?? 0) > 0;
    }
    async archive(conversationId, userId) {
        const { rowCount } = await this.db.query(`
      UPDATE agent.conversations
      SET status = 'archived', last_active_at = NOW()
      WHERE conversation_id = $1 AND user_id = $2
    `, [conversationId, userId]);
        return (rowCount ?? 0) > 0;
    }
    async maybeCompress(conversationId) {
        const count = await this.countMessages(conversationId);
        if (count <= this.windowSize * 2)
            return;
        const oldMsgs = await this.getOldestMessages(conversationId, this.windowSize);
        const oldText = oldMsgs.map((m) => `${m.role}: ${m.content}`).join('\n');
        const summary = await this.summarize(oldText);
        await this.db.query(`
      DELETE FROM agent.messages WHERE message_id IN (
        SELECT message_id FROM agent.messages
        WHERE conversation_id = $1
        ORDER BY message_id ASC LIMIT $2
      )
    `, [conversationId, this.windowSize]);
        await this.db.query(`
      UPDATE agent.conversations
      SET summary = COALESCE(summary, '') || $2 || E'\n---\n'
      WHERE conversation_id = $1
    `, [conversationId, summary]);
    }
    async countMessages(conversationId) {
        const { rows } = await this.db.query(`SELECT COUNT(*)::int AS n FROM agent.messages WHERE conversation_id = $1`, [conversationId]);
        return rows[0].n;
    }
    async getOldestMessages(conversationId, n) {
        const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id ASC LIMIT $2
    `, [conversationId, n]);
        return rows.map((r) => ({
            messageId: r.message_id, role: r.role, content: r.content,
            toolCalls: r.tool_calls, toolResults: r.tool_results, thinking: r.thinking, createdAt: r.created_at,
        }));
    }
    async summarize(text) {
        if (text.length < 100)
            return text;
        if (!this.summarizer)
            return '(summary disabled)';
        try {
            return await this.summarizer.summarize(text);
        }
        catch {
            return '(summary failed)';
        }
    }
    // ── R7 (Phase 3): events replay ─────────────────────────────────────
    // runner 每条 emitter.send 之前 recordEvent 落库;replay 端点 GET /events
    // 按 id > $after 增量拉。失败也不抛,只 log — emitter 不应被 DB 拖垮。
    async recordEvent(conversationId, type, payload) {
        const id = makeEventId();
        const ts = Date.now();
        try {
            await this.db.query(`
        INSERT INTO agent.message_events (id, conversation_id, type, payload, ts)
        VALUES ($1, $2, $3, $4, $5)
      `, [id, conversationId, type, JSON.stringify(payload), ts]);
        }
        catch (e) {
            console.warn(`[conversation] recordEvent failed: ${e.message}`);
        }
    }
    async getEvents(conversationId, after = '', limit = 100) {
        const { rows } = await this.db.query(`
      SELECT id, conversation_id, type, payload, ts, created_at
      FROM agent.message_events
      WHERE conversation_id = $1 AND id > $2
      ORDER BY id ASC
      LIMIT $3
    `, [conversationId, after, limit]);
        return rows.map((r) => ({
            id: r.id,
            conversationId: r.conversation_id,
            type: r.type,
            payload: r.payload,
            ts: Number(r.ts),
            createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        }));
    }
}
/** 'evt_<base36ts>_<rand6>' — 时间序前缀让 `WHERE id > $after` 命中 B-tree */
function makeEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    return `evt_${ts}_${rand}`;
}
