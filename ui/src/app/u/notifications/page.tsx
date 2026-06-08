// ui/src/app/u/notifications/page.tsx
// Notification center: shows agent task history (weekly_bank_review, etc.).
// SSR-fetched from /api/notifications (proxies agent /api/tasks).
import { getSessionUser } from '@/lib/auth-server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type AgentTask = {
  task_id: string
  task_type: string
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | string
  progress?: number
  created_at: string
  error?: string | Record<string, unknown>
}

async function fetchTasks(userId: string, role: string, limit: number): Promise<AgentTask[]> {
  const base = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'
  try {
    const r = await fetch(`${base}/api/tasks?user_id=${userId}&limit=${limit}`, {
      headers: {
        'x-wdg-user-id': userId,
        'x-wdg-user-role': role,
      },
      cache: 'no-store',
    })
    if (!r.ok) return []
    const data = (await r.json()) as { tasks?: AgentTask[] }
    return data.tasks ?? []
  } catch {
    return []
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'DONE':
      return 'text-green-600'
    case 'FAILED':
      return 'text-red-600'
    case 'RUNNING':
      return 'text-blue-600'
    case 'PENDING':
      return 'text-yellow-600'
    default:
      return 'text-gray-600'
  }
}

export default async function NotificationsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const tasks = await fetchTasks(user.user_id, user.role, 20)

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">通知中心</h1>
      <p className="text-sm text-gray-500 mb-6">
        任务执行历史和实时进度. agent 跑过的 weekly_bank_review 等任务在这里.
      </p>

      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.task_id} className="border rounded p-3 bg-white">
            <div className="font-mono text-sm font-semibold">{t.task_type}</div>
            <div className="text-xs text-gray-500 mt-1">
              状态:{' '}
              <span className={statusColor(t.status)}>{t.status}</span>
              {' · '}进度: {t.progress ?? 0}%
              {' · '}
              {new Date(t.created_at).toLocaleString('zh-CN')}
            </div>
            {t.error && (
              <div className="text-xs text-red-500 mt-1">
                错误: {typeof t.error === 'string' ? t.error : JSON.stringify(t.error)}
              </div>
            )}
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="text-gray-500 italic p-4 border rounded bg-white">
            暂无通知. agent 跑任务后会出现在这里.
          </li>
        )}
      </ul>
    </main>
  )
}
