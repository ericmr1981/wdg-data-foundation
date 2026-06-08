// agent/src/channels/web.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Channel, IncomingMsg, OutgoingMsg } from './types.ts'
import type { ChannelManager } from './manager.ts'

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
    this.wss = new WebSocketServer({ port: this.port })
  }

  async start(): Promise<void> {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const userId = url.searchParams.get('userId') ?? 'anonymous'
      const conversationId = url.searchParams.get('conversationId')

      this.clients.set(ws, { ws, userId, conversationId })

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
