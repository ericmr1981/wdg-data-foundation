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

export class NullNotifier implements Notifier {
  async push(_: Notification) { /* no-op */ }
}
