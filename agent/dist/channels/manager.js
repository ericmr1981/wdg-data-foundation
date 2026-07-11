// agent/src/channels/manager.ts
// R7 (Phase 3) follow-up: drop legacy `OutgoingMsg` envelope dispatch.
// Runner 直接通过 emitter 回推 ChatOutgoing frame(web.ts 的 ChatEmitter)。
// Manager 只剩两个责任:
//   1. cron → scheduler.enqueue
//   2. 即时对话 → runner.handle(msg, emitter),emitter 由 caller 注入
//
// runner.handle 的返回签名简化为 { conversationId, messageId? } — `result.text`
// 和 `steps` 不再需要,因为每条 frame 已经实时推到 emitter,且 recordEvent 已经
// 落库(`runner` 内部完成)。
export class ChannelManager {
    webChannel;
    runner;
    scheduler;
    constructor(webChannel, runner, scheduler) {
        this.webChannel = webChannel;
        this.runner = runner;
        this.scheduler = scheduler;
    }
    async onIncoming(msg, emitter) {
        // 1. Cron 触发的, 走任务队列
        if (msg.channelId === 'cron' && typeof msg.metadata?.taskType === 'string' && this.scheduler) {
            await this.scheduler.enqueue({
                taskType: msg.metadata.taskType,
                input: msg.metadata,
                triggeredBy: msg.userId,
            });
            return;
        }
        // 2. 即时对话, 走 AgentRunner;emitter 由 web.ts 注入(ChatEmitter)
        await this.runner.handle(msg, emitter);
        void this.webChannel; // webChannel 由 Notifier(WebNotifier) 用于 cron 推送;manager 不再直接 send
    }
}
