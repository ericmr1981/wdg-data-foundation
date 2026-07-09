// agent/src/channels/web.ts
// R5 (Phase 1c) — WS 协议握手 + 帧路由重写
// 状态机: connect → hello → auth (60s timeout) → user.message / user.interrupt / ping
// 所有 outgoing frames 走 ChatEmitter (R3 invariant)。

import { WebSocketServer, WebSocket } from 'ws'
import type { ChatIncoming, ContentBlock } from './chat-types.js'
import { PROTOCOL_VERSION } from './chat-types.js'
import { ChatEmitter } from './chat-emitter.js'
import { verifyAgentToken } from './auth.js'
import type { IncomingMsg } from './types.js'

interface Client {
  ws: WebSocket
  emitter: ChatEmitter
  userId: string | null
  conversationId: string | null
  authed: boolean
  authTimer: NodeJS.Timeout | null
}

/**
 * ChannelManagerLike — R5 阶段把 ChannelManager 注入 web.ts 的最小契约。
 * web.ts 只需要 onIncoming 一条路径;manager 内部仍走 runner / scheduler。
 * rawContent 是可选字段(R5.5 透传 block array 给 runner 用)。
 */
export interface ChannelManagerLike {
  onIncoming(msg: IncomingMsg & { rawContent?: ContentBlock[]; messageId?: string }): Promise<void>
}

export class WebChannel {
  channelId = 'web' as const
  private wss: WebSocketServer
  private clients = new Map<WebSocket, Client>()
  /** Latest protocol version this build supports */
  readonly protocolVersion = PROTOCOL_VERSION

  constructor(
    private port: number,
    private manager: ChannelManagerLike | null,
  ) {
    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' })
  }

  /**
   * R5: inject manager after construction (resolves cyclic dep:
   * ChannelManager needs WebChannel for send(), WebChannel needs manager for onIncoming).
   * Replaces the earlier `(webChannel as any).manager = manager` hack.
   */
  setManager(manager: ChannelManagerLike): void {
    this.manager = manager
  }

  async start(): Promise<void> {
    this.wss.on('connection', (ws) => {
      const emitter = new ChatEmitter(ws)
      const client: Client = {
        ws,
        emitter,
        userId: null,
        conversationId: null,
        authed: false,
        authTimer: null,
      }
      this.clients.set(ws, client)

      // 步骤 1: 立即发 hello
      void emitter.send({
        type: 'hello',
        payload: { protocolVersion: PROTOCOL_VERSION, sessionId: 'srv' },
      })

      // 步骤 2: 60 秒内必须收到 auth,否则 close(1008)
      client.authTimer = setTimeout(() => {
        if (!client.authed) {
          emitter.close(1008, 'auth_timeout')
          this.clients.delete(ws)
        }
      }, 60_000)

      // 步骤 3: 处理 incoming frames
      ws.on('message', async (raw) => {
        let frame: ChatIncoming
        try {
          frame = JSON.parse(raw.toString()) as ChatIncoming
        } catch {
          // bad json — silently drop
          return
        }

        if (!client.authed) {
          // auth 之前收到别的 → 丢
          if (frame.type !== 'auth') return

          try {
            const claims = verifyAgentToken(frame.payload.token)
            client.userId = claims.sub
            client.authed = true
            if (client.authTimer) {
              clearTimeout(client.authTimer)
              client.authTimer = null
            }
          } catch (e) {
            const msg = (e as Error).message
            const reason = msg.startsWith('EXPIRED_TOKEN') ? 'expired_token' : 'invalid_token'
            emitter.close(1008, reason)
            this.clients.delete(ws)
            return
          }
          return // auth 已处理,等下一帧 user.message
        }

        // authed 之后,按 type 路由
        if (frame.type === 'auth') return // 重发不处理

        if (frame.type === 'ping') {
          await emitter.send({ type: 'pong', payload: { ts: frame.payload.ts } })
          return
        }

        if (frame.type === 'user.message') {
          // 立即回 ack(≤200ms)— messageId 必须原样回
          await emitter.send({
            type: 'ack',
            payload: { messageId: frame.payload.messageId, ts: Date.now() },
          })
          await this.onUserMessage(client, frame.payload)
          return
        }

        if (frame.type === 'user.interrupt') {
          await this.onUserInterrupt(client, frame.payload)
          return
        }
      })

      ws.on('close', () => {
        if (client.authTimer) clearTimeout(client.authTimer)
        this.clients.delete(ws)
      })
      ws.on('error', () => { this.clients.delete(ws) })
    })
  }

  /** Hook for ChannelManager — R5.5 完整注入 */
  async onUserMessage(
    client: Client,
    payload: Extract<ChatIncoming, { type: 'user.message' }>['payload'],
  ): Promise<void> {
    if (payload.conversationId) client.conversationId = payload.conversationId

    if (!this.manager) {
      // R5 阶段 manager 还没注入, 不报错, 留 ack 即可
      console.warn('[web] onUserMessage: no manager wired yet')
      return
    }

    const contentText = extractText(payload.content)
    await this.manager.onIncoming({
      channelId: 'web',
      userId: client.userId!,
      brand: payload.brand ?? null,
      conversationId: payload.conversationId,
      content: contentText,
      rawContent: payload.content,
      messageId: payload.messageId,
      attachments: payload.attachments,
    })
  }

  async onUserInterrupt(
    client: Client,
    payload: Extract<ChatIncoming, { type: 'user.interrupt' }>['payload'],
  ): Promise<void> {
    await client.emitter.send({
      type: 'interrupted',
      payload: { conversationId: payload.conversationId, reason: payload.reason ?? 'user' },
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }
}

/** Helper: 把 ContentBlock[] 拍平为单 string(给 runner 当 content) */
function extractText(blocks: ContentBlock[]): string {
  if (typeof blocks === 'string') return blocks
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b) => (b && typeof b === 'object' && (b as any).type === 'text' ? (b as any).text : ''))
    .filter((s) => s.length > 0)
    .join('\n')
}