// NullEmitter — cron / 测试用 no-op emitter。
// cron 触发的对话没有 ws client,runner.handle 不应被 send 抛错拖垮。
import type { ChatOutgoing } from './chat-types.js'

export class NullEmitter {
  async send(_frame: ChatOutgoing | any): Promise<void> {
    // no-op
  }
}