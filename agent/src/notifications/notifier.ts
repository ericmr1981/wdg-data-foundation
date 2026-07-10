// agent/src/notifications/notifier.ts
export type NotificationType =
  | 'task_update' | 'task_done' | 'task_failed'
  | 'cron_fired' | 'system_error'

export interface Notification {
  type: NotificationType
  conversationId: string | null  // null = 不推 UI, 只记 audit
  payload: any
}

export interface Notifier {
  push(notification: Notification): Promise<void>
}

/**
 * R7 (Phase 3) follow-up: 真正的 pub/sub 实现,而不是 no-op stub。
 * 构造时 webChannel 为 null(规避 server.ts 构造顺序);wireWebChannel() 在
 * server.ts 创建 WebChannel 之后调用,把 channel 注入。
 * push 时:
 *   - 不持久化 — chat frames 已经在 runner 落 agent.message_events
 *   - 没有目标会话(conversationId null) → 只 console.log,不当 error
 *   - conversationId 找到 0 个 ws client → console.log,no-op(用户未登录)
 */
import type { WebChannel } from '../channels/web.js'

export class NullNotifier implements Notifier {
  async push(_: Notification) { /* no-op */ }
}

export class WebNotifier implements Notifier {
  private webChannel: WebChannel | null = null

  constructor(webChannel: WebChannel | null = null) {
    this.webChannel = webChannel
  }

  /** 后注入 webChannel(规避 server.ts 的构造顺序) */
  wireWebChannel(channel: WebChannel): void {
    this.webChannel = channel
  }

  async push(n: Notification): Promise<void> {
    if (!n.conversationId) {
      console.log(`[notifier] ${n.type} (no conversationId — audit only)`)
      return
    }
    if (!this.webChannel) {
      console.warn(`[notifier] ${n.type} dropped — webChannel not wired`)
      return
    }
    await this.webChannel.sendToConversation(n.conversationId, {
      type: n.type,
      payload: n.payload,
    })
  }
}
