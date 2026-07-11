export class NullNotifier {
    async push(_) { }
}
export class WebNotifier {
    webChannel = null;
    constructor(webChannel = null) {
        this.webChannel = webChannel;
    }
    /** 后注入 webChannel(规避 server.ts 的构造顺序) */
    wireWebChannel(channel) {
        this.webChannel = channel;
    }
    async push(n) {
        if (!n.conversationId) {
            console.log(`[notifier] ${n.type} (no conversationId — audit only)`);
            return;
        }
        if (!this.webChannel) {
            console.warn(`[notifier] ${n.type} dropped — webChannel not wired`);
            return;
        }
        await this.webChannel.sendToConversation(n.conversationId, {
            type: n.type,
            payload: n.payload,
        });
    }
}
