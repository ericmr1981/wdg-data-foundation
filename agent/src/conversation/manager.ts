// agent/src/conversation/manager.ts
// 短期记忆: conversation 生命周期 + LLM 压缩
// getOrCreate / appendMessage / getMessages / maybeCompress (滑动窗口)

import type { Pool } from 'pg'
import type Anthropic from '@anthropic-ai/sdk'

export interface IncomingMsg {
  channelId: string
  userId: string
  brand: string | null
  conversationId: string | null
  content: string
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

export class ConversationManager {
  constructor(
    private db: Pool,
    private anthropic: Anthropic,
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
    try {
      const res = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `请用 200 字以内总结以下对话的关键事实 (业务数据、用户偏好、判断结论):\n\n${text}`,
        }],
      })
      const block = res.content[0]
      return block && block.type === 'text' ? block.text : ''
    } catch {
      return '(summary failed)'
    }
  }
}
