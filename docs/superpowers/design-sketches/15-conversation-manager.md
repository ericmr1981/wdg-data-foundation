# WDG v1 — ConversationManager (短期记忆)

> v0: session-store.ts, 内存 + DB 双层, 走 globalThis 单例
> v1: DB 为主, 滑动窗口 + 旧消息 summary 压缩

## 1. 职责

```
ConversationManager 负责:
  · 创建/查找 conversation
  · 存消息 (user / assistant / tool / system)
  · 滑动窗口: 最近 10 轮全量, 之前 summary 压缩
  · 给 AgentRunner 提供 getMessages(convId, limit)

ConversationManager 不负责:
  · 鉴权 (Channel 适配层)
  · 跨用户 / 跨品牌分析 (v1 不做长期记忆, 不分析)
```

## 2. DDL (跟 v0 设计的 agent schema 一致, 略)

```sql
CREATE TABLE agent.conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  brand             TEXT,
  channel_id        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  summary           TEXT,                          -- 旧消息的 LLM 压缩
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent.messages (
  message_id        BIGSERIAL PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES agent.conversations(conversation_id),
  role              TEXT NOT NULL,                -- 'user' | 'assistant' | 'tool' | 'system'
  content           TEXT NOT NULL,
  tool_calls        JSONB,
  tool_results      JSONB,
  thinking          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

## 3. 接口

```typescript
// agent/src/conversation/manager.ts

import { Pool } from 'pg'
import { IncomingMsg } from '../channels/types'
import Anthropic from '@anthropic-ai/sdk'

export interface ConversationMessage {
  messageId: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls: any | null
  toolResults: any | null
  thinking: string | null
  createdAt: Date
}

export class ConversationManager {
  constructor(
    private db: Pool,
    private anthropic: Anthropic,           // 用于 summary
    private windowSize: number = 10,        // 最近 10 轮全量
  ) {}

  // ─── 查 / 建 ────────────────────────────

  async getOrCreate(msg: IncomingMsg): Promise<{ conversationId: string }> {
    if (msg.conversationId) {
      // 已有会话, 刷新 last_active_at
      await this.db.query(
        `UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`,
        [msg.conversationId],
      )
      return { conversationId: msg.conversationId }
    }

    // 新会话
    const { rows } = await this.db.query(`
      INSERT INTO agent.conversations
        (user_id, brand, channel_id)
      VALUES ($1, $2, $3)
      RETURNING conversation_id
    `, [msg.userId, msg.brand, msg.channelId])

    return { conversationId: rows[0].conversation_id }
  }

  // ─── 取历史 (滑动窗口) ─────────────────

  async getMessages(conversationId: string, limit: number): Promise<ConversationMessage[]> {
    // 取最近 limit 条
    const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id DESC
      LIMIT $2
    `, [conversationId, limit])

    // 反转 (按时间正序)
    const msgs = rows.reverse().map(r => ({
      messageId: r.message_id,
      role: r.role,
      content: r.content,
      toolCalls: r.tool_calls,
      toolResults: r.tool_results,
      thinking: r.thinking,
      createdAt: r.created_at,
    }))

    return msgs
  }

  // ─── 写消息 ────────────────────────────

  async appendMessage(msg: {
    conversationId: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    toolCalls?: any
    toolResults?: any
    thinking?: string
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO agent.messages
        (conversation_id, role, content, tool_calls, tool_results, thinking)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      msg.conversationId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolResults ? JSON.stringify(msg.toolResults) : null,
      msg.thinking ?? null,
    ])

    await this.db.query(
      `UPDATE agent.conversations SET last_active_at = NOW() WHERE conversation_id = $1`,
      [msg.conversationId],
    )
  }

  // ─── Summary 压缩 ─────────────────────

  /**
   * 触发时机: appendMessage 后, 如果消息数 > windowSize * 2
   * 行为: 把最旧的 N 条消息压缩成 1 段 summary, 写到 conversations.summary
   */
  async maybeCompress(conversationId: string): Promise<void> {
    const count = await this.countMessages(conversationId)
    if (count <= this.windowSize * 2) return

    // 找最旧的 windowSize 条
    const oldMsgs = await this.getOldestMessages(conversationId, this.windowSize)
    const oldSummary = oldMsgs.map(m => `${m.role}: ${m.content}`).join('\n')

    // 调 LLM 压缩
    const summary = await this.summarize(oldSummary)

    // 删除这些消息, 写 summary
    await this.db.query(`
      DELETE FROM agent.messages
      WHERE message_id IN (
        SELECT message_id FROM agent.messages
        WHERE conversation_id = $1
        ORDER BY message_id ASC
        LIMIT $2
      )
    `, [conversationId, this.windowSize])

    await this.db.query(`
      UPDATE agent.conversations
      SET summary = COALESCE(summary, '') || $2 || E'\n---\n'
      WHERE conversation_id = $1
    `, [conversationId, summary])
  }

  private async summarize(text: string): Promise<string> {
    const res = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `请用 200 字以内总结以下对话的关键事实 (业务数据、用户偏好、判断结论):\n\n${text}`,
      }],
    })
    return res.content[0].type === 'text' ? res.content[0].text : ''
  }

  private async countMessages(conversationId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM agent.messages WHERE conversation_id = $1`,
      [conversationId],
    )
    return rows[0].n
  }

  private async getOldestMessages(conversationId: string, n: number) {
    const { rows } = await this.db.query(`
      SELECT * FROM agent.messages
      WHERE conversation_id = $1
      ORDER BY message_id ASC
      LIMIT $2
    `, [conversationId, n])
    return rows
  }
}
```

## 4. 滑动窗口 (给 AgentRunner 用)

```typescript
// AgentRunner 调用:
const summary = await conv.getSummary(convId)         // conversations.summary
const recent = await conv.getMessages(convId, 10)     // 最近 10 条

// 拼 messages:
const messages = [
  // summary 作为 system 或 user 注入
  { role: 'system', content: `历史摘要: ${summary}` },
  // 然后是最近 10 条
  ...recent.map(m => ({ role: m.role, content: m.content })),
  // 然后是当前用户消息
  { role: 'user', content: msg.content },
]
```

## 5. 跟 v0 的对比

| 项 | v0 (session-store.ts) | v1 (ConversationManager) |
|---|---|---|
| 存储 | 内存 (Map) + 偶尔落 DB | **DB 为主** |
| 进程边界 | Next.js 进程内 | **Agent 进程内** (PG 跨进程 OK) |
| 滑动窗口 | 简单的 LRU | **滑动窗口 + summary 压缩** |
| 并发 | 单进程, 无锁 | **DB 事务** (PG 行锁) |
| 总结 | 无 | **LLM 压缩旧消息** (haiku, 便宜) |
| v0 UI 兼容 | n/a | **不直接相关**, session 概念在 v1 由 conversation 替代 |

**v0 的 session-store.ts 整体不再需要** —— v1 用 DB 直接管 conversation。

## 6. 这个组件你看什么

- **滑动窗口 + LLM 压缩** 是 v1 比 v0 多的能力 (v0 没总结)
- **DB 为唯一真源**, 不靠内存, 进程重启不丢
- **用 haiku 压缩** (便宜), 触发条件: 消息数 > 20 (windowSize × 2)
- **不做长期记忆** (你之前去掉了), 跨会话的偏好/结论不主动写
