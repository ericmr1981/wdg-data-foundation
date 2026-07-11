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
 * R7 follow-up: 第二参数 emitter 由 web.ts 注入,manager 直接转发给 runner。
 */
export interface ChannelManagerLike {
  onIncoming(
    msg: IncomingMsg & { rawContent?: ContentBlock[]; messageId?: string },
    emitter: { send: (f: any) => Promise<void> },
  ): Promise<void>
}

export class WebChannel {
  channelId = 'web' as const
  private wss: WebSocketServer
  private clients = new Map<WebSocket, Client>()
  /** R6 (Phase 2): per-conversation AbortController pool.
   * key = conversationId (or `__new_<n>` 当 convId 暂未分配);AC is created on
   * user.message, looked up on user.interrupt, and cleared once consumed. signal
   * is plumbed through manager → runner so SDK toolRunner aborts cleanly on
   * user interrupt.
   */
  private abortControllers = new Map<string, AbortController>()
  /** Monotonic counter for synthetic AC keys when conversationId is null */
  private nullConvCounter = 0
  /** Latest protocol version this build supports */
  readonly protocolVersion = PROTOCOL_VERSION

  constructor(
    private port: number,
    private manager: ChannelManagerLike | null,
  ) {
    this.wss = new WebSocketServer({ port: this.port, host: '0.0.0.0' })
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

      // 步骤 0: R7 — 协议版本不匹配立即 close(4000 protocol_error)
      // env AGENT_PROTOCOL_VERSION 默认 = 内建 PROTOCOL_VERSION (= 1)
      // 升级切新版本时可临时设 AGENT_PROTOCOL_VERSION=0 → 强制关老客户端
      const envVersion = process.env.AGENT_PROTOCOL_VERSION
        ? parseInt(process.env.AGENT_PROTOCOL_VERSION, 10)
        : PROTOCOL_VERSION
      if (envVersion !== PROTOCOL_VERSION) {
        console.error(`[web] AGENT_PROTOCOL_VERSION=${envVersion} mismatches built-in ${PROTOCOL_VERSION}`)
        emitter.close(4000, 'protocol_mismatch')
        this.clients.delete(ws)
        return
      }

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

      // I2 fix: close/error → clean up AC pool + clients map (was: only clients.map)
      // 防止 ws 断开时该 convId 上的 AC 残留,后续 user.interrupt 拿到一个过期 signal。
      const teardown = () => {
        if (client.authTimer) {
          clearTimeout(client.authTimer)
          client.authTimer = null
        }
        if (client.conversationId && this.abortControllers.has(client.conversationId)) {
          this.abortControllers.delete(client.conversationId)
        }
        this.clients.delete(ws)
      }
      ws.on('close', teardown)
      ws.on('error', teardown)

      // 步骤 3: 处理 incoming frames
      // 路 4: sync crypto.verify handler
      ws.on('message', (raw: any) => {
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
              const claims = verifyAgentToken(frame.payload.token)  // 路 4: 同步
              client.userId = claims.sub
              client.authed = true
              if (client.authTimer) {
                clearTimeout(client.authTimer)
                client.authTimer = null
              }
            } catch (e) {
              const msg = (e as Error).message
              console.error('[ws] auth failed:', msg, (e as Error).stack?.slice(0, 200))
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
            emitter.send({ type: 'pong', payload: { ts: frame.payload.ts } })
            return
          }

          if (frame.type === 'user.message') {
            // 立即回 ack(≤200ms)— messageId 必须原样回
            emitter.send({
              type: 'ack',
              payload: { messageId: frame.payload.messageId, ts: Date.now() },
            })
            this.onUserMessage(client, frame.payload).catch((e: unknown) => {
              const m = (e as Error).message ?? String(e)
              console.error('[ws] onUserMessage ERROR:', m, (e as Error).stack?.slice(0, 300))
              emitter.send({ type: 'error', payload: { code: 'invalid_request' as any, http_status: 500, message: m } }).catch(() => {})
            })
            return
          }

          if (frame.type === 'user.interrupt') {
            this.onUserInterrupt(client, frame.payload).catch((e: unknown) => {
              console.error('[ws] onUserInterrupt error:', (e as Error).message)
            })
            return
          }
      })
    })
  }

  /**
   * Hook for ChannelManager — R5.5 完整注入 */
  async onUserMessage(
    client: Client,
    payload: Extract<ChatIncoming, { type: 'user.message' }>['payload'],
  ): Promise<void> {
    console.log('[web] onUserMessage convId=' + (payload.conversationId ?? 'null') + ' manager=' + (this.manager ? 'yes' : 'no'))
    if (payload.conversationId) client.conversationId = payload.conversationId

    if (!this.manager) {
      // R5 阶段 manager 还没注入, 不报错, 留 ack 即可
      console.warn('[web] onUserMessage: no manager wired yet')
      return
    }

    // R6 (Phase 2): new AC per message; supersedes any stale AC for this conversation
    // I3 fix: 旧的 `payload.conversationId` 直接当 key — 当 convId 为 null 时多个并发请求
    // 会互相覆盖同一个 AC,sentinel 用 `__new_<n>` 区分;convId 真正来时切换。
    const acKey = payload.conversationId ?? `__new_${++this.nullConvCounter}`
    const ac = new AbortController()
    this.abortControllers.set(acKey, ac)

    const contentText = extractText(payload.content)
    await this.manager.onIncoming(
      {
        channelId: 'web',
        userId: client.userId!,
        brand: payload.brand ?? null,
        conversationId: payload.conversationId,
        content: contentText,
        rawContent: payload.content,
        messageId: payload.messageId,
        attachments: payload.attachments,
        signal: ac.signal,
      },
      client.emitter,
    )
  }

  async onUserInterrupt(
    client: Client,
    payload: Extract<ChatIncoming, { type: 'user.interrupt' }>['payload'],
  ): Promise<void> {
    // R6 (Phase 2): abort in-flight SDK call → SDK throws AbortError → token usage stops
    const ac = this.abortControllers.get(payload.conversationId)
    if (ac) {
      ac.abort()
      this.abortControllers.delete(payload.conversationId)
    }
    await client.emitter.send({
      type: 'interrupted',
      payload: { conversationId: payload.conversationId, reason: payload.reason ?? 'user' },
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  /**
   * R7: 广播一条 frame 给 conversationId 绑定的所有 ws client。
   * 给 Notifier(Cron → task_update / task_done / task_failed / cron_fired) 用。
   * 设计:
   *  - 接受泛型 frame(用 ChatOutgoing 形状,但 caller 包 envelope 保持老 OutgoingMsg 兼容)
   *  - 不写 DB(replay 端点已持久化每条 chat frame;legacy envelope 不必双重写)
   *  - 没有匹配 client 时静默 drop — cron 任务触发时用户可能没连 ws
   */
  async sendToConversation(conversationId: string, frame: any): Promise<void> {
    let sent = 0
    for (const client of this.clients.values()) {
      if (client.conversationId === conversationId) {
        try {
          await client.emitter.send(frame)
          sent++
        } catch (e) {
          // 单 client 失败不影响其他
          console.warn(`[web] sendToConversation client error: ${(e as Error).message}`)
        }
      }
    }
    if (sent === 0) {
      // 不算错 — cron 触发时 portal 可能未登录
      console.log(`[web] sendToConversation(${conversationId}): no clients`)
    }
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