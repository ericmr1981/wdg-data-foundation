// agent/src/channels/manager.ts
// 入口: 收 IncomingMsg, 决定走 AgentRunner 即时对话 还是 TaskScheduler 长任务
// T15 之后会接 AgentRunner; T18 之后会接 TaskScheduler
import type { IncomingMsg } from './types.ts'

export class ChannelManager {
  async onIncoming(_msg: IncomingMsg): Promise<void> {
    // v1 早期: 走 AgentRunner / TaskScheduler 留到 T15/T18
    // 这里暂时只 echo, 验证链路
    console.log('[ChannelManager] received msg (T15 will hook AgentRunner)')
  }
}
