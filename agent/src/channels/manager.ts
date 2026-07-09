// agent/src/channels/manager.ts
import type { IncomingMsg, OutgoingMsg } from './types.js'
import type { AgentRunner } from '../agent/runner.js'
import type { TaskScheduler } from '../tasks/scheduler.js'
import type { WebChannel } from './web.js'
import type { RunnerStep } from '../agent/runner.js'
import type { ContentBlock } from './chat-types.js'

/** R5.5 extension: web channel passes block-array + messageId extras. */
export type IncomingMsgExt = IncomingMsg & {
  rawContent?: ContentBlock[]
  messageId?: string
}

export class ChannelManager {
  constructor(
    private webChannel: WebChannel,
    private runner: AgentRunner,
    private scheduler?: TaskScheduler,
  ) {}

  async onIncoming(msg: IncomingMsgExt): Promise<void> {
    // 1. Cron 触发的, 走任务队列
    if (msg.channelId === 'cron' && typeof msg.metadata?.taskType === 'string' && this.scheduler) {
      await this.scheduler.enqueue({
        taskType: msg.metadata.taskType as string,
        input: msg.metadata,
        triggeredBy: msg.userId,
      })
      return
    }

    // 2. 即时对话, 走 AgentRunner; 收集 steps 同时通过 task_update 增量推送
    const steps: RunnerStep[] = []
    const pushStep = async (s: RunnerStep) => {
      steps.push(s)
      if (msg.channelId === 'web') {
        await this.webChannel.send({
          channelId: msg.channelId,
          conversationId: null,
          type: 'task_update',
          payload: { kind: 'step', step: s },
        })
      }
    }

    const result = await this.runner.handle(msg, pushStep)

    // 3. 终态: task_done 带回完整 steps 列表 + 文本
    const reply: OutgoingMsg = {
      channelId: msg.channelId,
      conversationId: result.conversationId,
      type: 'task_done',
      payload: { content: result.text, steps },
    }
    await this.webChannel.send(reply)
  }
}