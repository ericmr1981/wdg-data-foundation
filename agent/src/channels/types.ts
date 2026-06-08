// agent/src/channels/types.ts
// 消息类型: IncomingMsg (用户→Agent) / OutgoingMsg (Agent→用户)
// T6 起实际承载数据, 之前是 stub

export type ChannelId = 'web' | 'telegram' | 'slack' | 'console' | 'cron'

export interface IncomingMsg {
  channelId: ChannelId
  userId: string
  brand: string | null
  conversationId: string | null
  content: string
  attachments?: unknown
  metadata?: Record<string, unknown>
}

export interface OutgoingMsg {
  channelId: ChannelId
  conversationId: string | null
  type: 'task_update' | 'task_done' | 'task_failed' | 'system_error' | 'cron_fired'
  payload: unknown
}

export interface Channel {
  readonly channelId: ChannelId
  start(): Promise<void>
  stop(): Promise<void>
  send(msg: OutgoingMsg): Promise<void>
}
