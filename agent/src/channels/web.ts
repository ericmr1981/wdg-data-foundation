// agent/src/channels/web.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Channel, IncomingMsg, OutgoingMsg } from './types.js'
import type { ChannelManager } from './manager.js'
import { verifyAgentToken } from './auth.js'

interface Client {
  ws: WebSocket
  userId: string
  conversationId: string | null
}

export class WebChannel implements Channel {
  channelId = 'web' as const
  private wss: WebSocketServer
  private clients = new Map<WebSocket, Client>()

  constructor(
    private port: number,
    private manager: ChannelManager | null,
  ) {
    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' })
  }

  async start(): Promise<void> {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const token = url.searchParams.get('token')

      let userId: string
      try {
        if (!token) {
          ws.close(1008, 'missing_token')
          return
        }
        const claims = verifyAgentToken(token)
        userId = claims.sub
      } catch (e) {
        const reason = (e as Error).message.startsWith('EXPIRED_TOKEN')
          ? 'expired_token'
          : 'invalid_token'
        ws.close(1008, reason)
        return
      }

      this.clients.set(ws, { ws, userId, conversationId: null })

      ws.on('message', async (raw) => {
        try {
          const data = JSON.parse(raw.toString())
          const msg: IncomingMsg = {
            channelId: 'web',
            userId,
            brand: data.brand ?? null,
            conversationId: data.conversationId ?? null,
            content: data.content ?? '',
            attachments: data.attachments,
            metadata: data.metadata,
          }
          // Sync client conversationId to the in-flight message so the
          // later reply (sent after getOrCreate / new conversationId) reaches this socket.
          if (data.conversationId) {
            const c = this.clients.get(ws)
            if (c) c.conversationId = data.conversationId
          }
          if (this.manager) {
            await this.manager.onIncoming(msg)
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'system_error', payload: { code: 'BAD_INPUT', message: (e as Error).message } }))
        }
      })

      ws.on('close', () => { this.clients.delete(ws) })
      ws.on('error', () => { this.clients.delete(ws) })
    })
  }

  async send(msg: OutgoingMsg): Promise<void> {
    for (const [ws, client] of this.clients) {
      if (msg.conversationId && client.conversationId !== msg.conversationId) continue
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: msg.type, payload: msg.payload }))
      }
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }
}
