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
  // 相对路径:浏览器拼成 ws://<location.host>/api/chat/ws
  return '/api/chat/ws'
}
