// ChatEmitter — 所有从 Agent 发往 Portal 的 ChatOutgoing 帧的唯一出口
import { WebSocket } from 'ws';
export class ChatEmitter {
    ws;
    constructor(ws) {
        this.ws = ws;
    }
    async send(frame) {
        if (this.ws.readyState !== WebSocket.OPEN)
            return; // drop on disconnect
        return new Promise((resolve, reject) => {
            this.ws.send(JSON.stringify(frame), (err) => err ? reject(err) : resolve());
        });
    }
    close(code, reason) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(code, reason);
        }
    }
}
