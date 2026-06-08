// agent/src/channels/cron.ts
import cron from 'node-cron'
import type { Channel, IncomingMsg } from './types.js'
import type { ChannelManager } from './manager.js'

interface CronEntry {
  schedule: string
  taskType: string
  metadata: Record<string, any>
}

export class CronChannel implements Channel {
  channelId = 'cron' as const
  private tasks: cron.ScheduledTask[] = []
  entries: CronEntry[] = [
    { schedule: process.env.CRON_WEEKLY_REVIEW ?? '0 9 * * 1', taskType: 'weekly_bank_review', metadata: { brand: null } },
  ]

  constructor(
    private manager: ChannelManager,
    private timezone: string = process.env.CRON_TIMEZONE ?? 'Asia/Shanghai',
  ) {}

  async start(): Promise<void> {
    for (const entry of this.entries) {
      const task = cron.schedule(entry.schedule, async () => {
        const msg: IncomingMsg = {
          channelId: 'cron',
          userId: 'system',
          brand: entry.metadata.brand ?? null,
          conversationId: null,
          content: `运行 ${entry.taskType}`,
          metadata: { ...entry.metadata, taskType: entry.taskType },
        }
        await this.manager.onIncoming(msg)
      }, { timezone: this.timezone })
      this.tasks.push(task)
    }
    console.log(`[cron] scheduled ${this.tasks.length} tasks`)
  }

  async send(): Promise<void> { /* cron 不主动推 */ }
  async stop(): Promise<void> { this.tasks.forEach(t => t.stop()) }
}
