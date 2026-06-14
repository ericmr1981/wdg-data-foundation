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

export function getAgentWsUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_WS_URL ?? 'ws://localhost:4101/ws'
}
