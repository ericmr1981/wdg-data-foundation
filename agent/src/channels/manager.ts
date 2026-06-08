// agent/src/channels/manager.ts
// Stub — T6 (WebChannel) 之后会重写
// ChannelManager 的最小接口,供 WebChannel 注入

import type { ChannelId, IncomingMsg, OutgoingMsg } from './types.ts'

export interface Channel {
  readonly channelId: ChannelId
  start(): Promise<void>
  stop(): Promise<void>
  send(msg: OutgoingMsg): Promise<void>
}

export interface ChannelManager {
  register(channel: Channel): void
  unregister(channelId: ChannelId): void
  dispatchIncoming(msg: IncomingMsg): Promise<void>
}
