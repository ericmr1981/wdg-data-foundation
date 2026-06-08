// agent/src/channels/types.ts
// Stub — T6 (WebChannel + ChannelManager) 之后会扩展/重写
// Notifier / WebNotifier 依赖的最小消息类型

export type ChannelId = 'web' | 'telegram' | 'slack' | 'console'

export interface IncomingMsg {
  channelId: ChannelId
  conversationId: string
  body: string
}

export interface OutgoingMsg {
  channelId: ChannelId
  conversationId: string
  type: 'task_update' | 'task_done' | 'task_failed' | 'system_error' | 'cron_fired'
  payload: unknown
}
