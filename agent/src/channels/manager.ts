// agent/src/channels/manager.ts
import type { IncomingMsg, OutgoingMsg } from './types.ts'
import type { AgentRunner } from '../agent/runner.ts'
import type { TaskScheduler } from '../tasks/scheduler.ts'
import type { WebChannel } from './web.ts'

export class ChannelManager {
  constructor(
    private webChannel: WebChannel,
    private runner: AgentRunner,
    private scheduler?: TaskScheduler,
  ) {}

  async onIncoming(msg: IncomingMsg): Promise<void> {
    // 1. Cron 触发的, 走任务队列
    if (msg.channelId === 'cron' && typeof msg.metadata?.taskType === 'string' && this.scheduler) {
      await this.scheduler.enqueue({
        taskType: msg.metadata.taskType as string,
        input: msg.metadata,
        triggeredBy: msg.userId,
      })
      return
    }

    // 2. 即时对话, 走 AgentRunner
    const result = await this.runner.handle(msg)

    // 3. 回推给原 channel
    const reply: OutgoingMsg = {
      channelId: msg.channelId,
      conversationId: result.conversationId,
      type: 'system_error',
      payload: { text: result.text },
    }
    await this.webChannel.send(reply)
  }
}
