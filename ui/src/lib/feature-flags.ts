// ui/src/lib/feature-flags.ts
// 控制 ChatDrawer / ChatWidget 切流到 Agent Service 的比例
// 用 NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT env (0-100)

export function shouldUseAgentService(userId: string | null | undefined): boolean {
  const flag = process.env.NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT ?? '0'
  const pct = parseInt(flag, 10)
  if (Number.isNaN(pct) || pct <= 0 || !userId) return false
  if (pct >= 100) return true
  // 简单哈希分流
  const hash = [...userId].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return (hash % 100) < pct
}

// 浏览器在用户电脑上,它看见的 location.origin 就是它实际访问的地址
// (e.g. http://112.124.18.246:3000)。这样 3000 走反代把 /api/chat/ws
// 转给内部 127.0.0.1:4102,agent WS 不需要公网 listen。
export function getAgentWsUrl(): string {
  // 本地开发: agent 在 VM 127.0.0.1:4102, Lima 转发 host 4102 → VM 4102
  if (process.env.NODE_ENV === 'development') {
    return 'ws://localhost:4102'
  }
  // 生产: VPS 上 ws-proxy 把 /api/chat/ws 转发到 127.0.0.1:4102
  return '/api/chat/ws'
}
