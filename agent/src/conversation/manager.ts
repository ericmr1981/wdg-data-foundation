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

import type { Pool } from 'pg'

export interface IncomingMsg {
  channelId: string
  userId: string
  brand: string | null
  conversationId: string | null
  content: string
  /** R6 (Phase 2): abort signal from channel; runner passes to toolRunner */
  signal?: AbortSignal
}

export interface ConversationMessage {
  messageId: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls: any | null
  toolResults: any | null
  thinking: string | null
  createdAt: Date
}

export interface ConversationSummary {
  conversationId: string
  brand: string | null
  title: string
  status: 'active' | 'archived'
  createdAt: Date
  lastActiveAt: Date
}

export interface StoredEvent {
  id: string
  conversationId: string
  type: string
  payload: any
  ts: number
  createdAt: string
}

/** LlmSummarizer 抽象 — R7 把 LLM 依赖从 ConversationManager 移出 */
export interface LlmSummarizer {
  summarize(text: string): Promise<string>
}

export class ConversationManager {
  constructor(
    private db: Pool,
    private summarizer: LlmSummarizer | null = null,
    private windowSize: number = 10,
  ) {}

  async getOrCreate(msg: IncomingMsg): Promise<{ conversationId: string }> {
    if (msg.conversationId) {
      await this.db.query(
        `UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`,
        [msg.conversationId],
      )
      return { conversationId: msg.conversationId }
    }
    const { rows } = await this.db.query(`
      INSERT INTO agent.conversations (user_id, brand, channel_id)
      VALUES ($1, $2, $3)
      RETURNING conversation_id
    `, [msg.userId, msg.brand, msg.channelId])
    return { conversationId: rows[0].conversation_id }
  }

  async getMessages(conversationId: string, limit: number): Promise<ConversationMessage[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id DESC
      LIMIT $2
    `, [conversationId, limit])
    return rows.reverse().map((r: any) => ({
      messageId: r.message_id,
      role: r.role,
      content: r.content,
      toolCalls: r.tool_calls,
      toolResults: r.tool_results,
      thinking: r.thinking,
      createdAt: r.created_at,
    }))
  }

  async getSummary(conversationId: string): Promise<string> {
    const { rows } = await this.db.query(
      `SELECT summary FROM agent.conversations WHERE conversation_id = $1`,
      [conversationId],
    )
    return rows[0]?.summary ?? ''
  }

  async appendMessage(msg: {
    conversationId: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    toolCalls?: any
    toolResults?: any
    thinking?: string
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO agent.messages (conversation_id, role, content, tool_calls, tool_results, thinking)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      msg.conversationId, msg.role, msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolResults ? JSON.stringify(msg.toolResults) : null,
      msg.thinking ?? null,
    ])
    await this.db.query(
      `UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`,
      [msg.conversationId],
    )
  }

  async listByUser(userId: string, limit: number = 50): Promise<ConversationSummary[]> {
    const { rows } = await this.db.query(`
      SELECT conversation_id, brand, title, status, created_at, last_active_at
      FROM agent.conversations
      WHERE user_id = $1 AND status = 'active'
      ORDER BY last_active_at DESC
      LIMIT $2
    `, [userId, limit])
    return rows.map((r: any) => ({
      conversationId: r.conversation_id,
      brand: r.brand,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
    }))
  }

  async getOne(conversationId: string, userId: string): Promise<ConversationSummary | null> {
    const { rows } = await this.db.query(`
      SELECT conversation_id, brand, title, status, created_at, last_active_at
      FROM agent.conversations
      WHERE conversation_id = $1 AND user_id = $2
    `, [conversationId, userId])
    if (rows.length === 0) return null
    const r = rows[0]
    return {
      conversationId: r.conversation_id,
      brand: r.brand,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
    }
  }

  async createEmpty(userId: string, brand: string | null, title?: string): Promise<{ conversationId: string; title: string }> {
    const { rows } = await this.db.query(`
      INSERT INTO agent.conversations (user_id, brand, channel_id, title)
      VALUES ($1, $2, 'web', $3)
      RETURNING conversation_id, title
    `, [userId, brand, title ?? '新会话'])
    return { conversationId: rows[0].conversation_id, title: rows[0].title }
  }

  async rename(conversationId: string, userId: string, title: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`
      UPDATE agent.conversations
      SET title = $3, last_active_at = NOW()
      WHERE conversation_id = $1 AND user_id = $2
    `, [conversationId, userId, title])
    return (rowCount ?? 0) > 0
  }

  async archive(conversationId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`
      UPDATE agent.conversations
      SET status = 'archived', last_active_at = NOW()
      WHERE conversation_id = $1 AND user_id = $2
    `, [conversationId, userId])
    return (rowCount ?? 0) > 0
  }

  async maybeCompress(conversationId: string): Promise<void> {
    const count = await this.countMessages(conversationId)
    if (count <= this.windowSize * 2) return
    const oldMsgs = await this.getOldestMessages(conversationId, this.windowSize)
    const oldText = oldMsgs.map((m: ConversationMessage) => `${m.role}: ${m.content}`).join('\n')
    const summary = await this.summarize(oldText)
    await this.db.query(`
      DELETE FROM agent.messages WHERE message_id IN (
        SELECT message_id FROM agent.messages
        WHERE conversation_id = $1
        ORDER BY message_id ASC LIMIT $2
      )
    `, [conversationId, this.windowSize])
    await this.db.query(`
      UPDATE agent.conversations
      SET summary = COALESCE(summary, '') || $2 || E'\n---\n'
      WHERE conversation_id = $1
    `, [conversationId, summary])
  }

  private async countMessages(conversationId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM agent.messages WHERE conversation_id = $1`,
      [conversationId],
    )
    return rows[0].n
  }

  private async getOldestMessages(conversationId: string, n: number): Promise<ConversationMessage[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id ASC LIMIT $2
    `, [conversationId, n])
    return rows.map((r: any) => ({
      messageId: r.message_id, role: r.role, content: r.content,
      toolCalls: r.tool_calls, toolResults: r.tool_results, thinking: r.thinking, createdAt: r.created_at,
    }))
  }

  private async summarize(text: string): Promise<string> {
    if (text.length < 100) return text
    if (!this.summarizer) return '(summary disabled)'
    try {
      return await this.summarizer.summarize(text)
    } catch {
      return '(summary failed)'
    }
  }

  // ── R7 (Phase 3): events replay ─────────────────────────────────────
  // runner 每条 emitter.send 之前 recordEvent 落库;replay 端点 GET /events
  // 按 id > $after 增量拉。失败也不抛,只 log — emitter 不应被 DB 拖垮。

  async recordEvent(
    conversationId: string,
    type: string,
    payload: any,
  ): Promise<void> {
    const id = makeEventId()
    const ts = Date.now()
    try {
      await this.db.query(`
        INSERT INTO agent.message_events (id, conversation_id, type, payload, ts)
        VALUES ($1, $2, $3, $4, $5)
      `, [id, conversationId, type, JSON.stringify(payload), ts])
    } catch (e) {
      console.warn(`[conversation] recordEvent failed: ${(e as Error).message}`)
    }
  }

  async getEvents(
    conversationId: string,
    after: string = '',
    limit: number = 100,
  ): Promise<StoredEvent[]> {
    const { rows } = await this.db.query(`
      SELECT id, conversation_id, type, payload, ts, created_at
      FROM agent.message_events
      WHERE conversation_id = $1 AND id > $2
      ORDER BY id ASC
      LIMIT $3
    `, [conversationId, after, limit])
    return rows.map((r: any) => ({
      id: r.id,
      conversationId: r.conversation_id,
      type: r.type,
      payload: r.payload,
      ts: Number(r.ts),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }))
  }
}

/** 'evt_<base36ts>_<rand6>' — 时间序前缀让 `WHERE id > $after` 命中 B-tree */
function makeEventId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `evt_${ts}_${rand}`
}
