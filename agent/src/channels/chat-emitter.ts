// ChatEmitter — 所有从 Agent 发往 Portal 的 ChatOutgoing 帧的唯一出口
import type { WebSocket } from 'ws'
import type { ChatOutgoing } from './chat-types.js'

export class ChatEmitter {
  constructor(private ws: WebSocket) {}

  async send(frame: ChatOutgoing): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) return  // drop on disconnect
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(frame), (err) => err ? reject(err) : resolve())
    })
  }

  close(code: number, reason: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(code, reason)
    }
  }
}
