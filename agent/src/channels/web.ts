// agent/src/channels/web.ts
// Stub — T6 (WebChannel) 之后会重写这个文件
// 这里是 Notifier/WebNotifier 依赖的最小接口

import type { OutgoingMsg } from './types.ts'
import type { Channel, ChannelManager } from './manager.ts'

export class WebChannel implements Channel {
  channelId = 'web' as const

  constructor(
    private port: number,
    private manager: ChannelManager | null,
  ) {
    void this.port
    void this.manager
  }

  async start(): Promise<void> {
    // T6 实际实现 WS server
  }

  async stop(): Promise<void> {
    // T6 实际关闭
  }

  async send(_msg: OutgoingMsg): Promise<void> {
    // T6 实际推送给 ws clients
  }
}
