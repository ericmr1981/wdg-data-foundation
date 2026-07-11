// agent/src/channels/cron.ts
import cron from 'node-cron';
import { NullEmitter } from './null-emitter.js';
export class CronChannel {
    manager;
    timezone;
    channelId = 'cron';
    tasks = [];
    entries = [
        { schedule: process.env.CRON_WEEKLY_REVIEW ?? '0 9 * * 1', taskType: 'weekly_bank_review', metadata: { brand: null } },
    ];
    constructor(manager, timezone = process.env.CRON_TIMEZONE ?? 'Asia/Shanghai') {
        this.manager = manager;
        this.timezone = timezone;
    }
    async start() {
        for (const entry of this.entries) {
            const task = cron.schedule(entry.schedule, async () => {
                const msg = {
                    channelId: 'cron',
                    userId: 'system',
                    brand: entry.metadata.brand ?? null,
                    conversationId: null,
                    content: `运行 ${entry.taskType}`,
                    metadata: { ...entry.metadata, taskType: entry.taskType },
                };
                await this.manager.onIncoming(msg, new NullEmitter());
            }, { timezone: this.timezone });
            this.tasks.push(task);
        }
        console.log(`[cron] scheduled ${this.tasks.length} tasks`);
    }
    async send() { }
    async stop() { this.tasks.forEach(t => t.stop()); }
}
