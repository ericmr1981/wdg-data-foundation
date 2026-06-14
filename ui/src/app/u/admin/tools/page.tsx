import { getSessionUser } from '@/lib/auth-server'
import { redirect } from 'next/navigation'
import ToolsList from './ToolsList'

export const dynamic = 'force-dynamic'

async function fetchTools() {
  const r = await fetch(`${process.env.AGENT_INTERNAL_URL}/api/admin/tools`, {
    headers: { 'x-wdg-user-id': 'admin-ssr', 'x-wdg-user-role': 'admin' },
    cache: 'no-store',
  })
  if (!r.ok) return { tools: [] }
  return r.json()
}

export default async function ToolsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/u/dashboard')

  const data = await fetchTools()

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">工具管理</h1>
      <p className="text-sm text-gray-500 mb-4">
        Agent 可用的 MCP 工具。禁用后 Agent 不会再调用该工具。
      </p>
      <ToolsList tools={data.tools ?? []} />
    </main>
  )
}
