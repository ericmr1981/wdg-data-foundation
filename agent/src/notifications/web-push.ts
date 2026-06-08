// agent/src/notifications/web-push.ts
import type { Notifier, Notification } from './notifier'
import type { WebChannel } from '../channels/web'

export class WebNotifier implements Notifier {
  constructor(private webChannel: WebChannel) {}

  async push(n: Notification) {
    if (!n.conversationId) return  // 没有目标会话, 不推
    await this.webChannel.send({
      channelId: 'web',
      conversationId: n.conversationId,
      type: n.type === 'task_update' ? 'task_update' : 'system_error',
      payload: n.payload,
    })
  }
}
