'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

type TaskStatus = 'NEW' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'PARTIAL'
type StepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'

interface Task {
  task_id: string
  parent_task_id: string | null
  conversation_id: string | null
  user_id: string | null
  task_type: string
  input: any
  status: TaskStatus
  progress: number
  result: any
  error: any
  created_at: string
  started_at: string | null
  finished_at: string | null
}

interface Step {
  task_id: string
  step_index: number
  description: string
  status: StepStatus
  started_at: string | null
  finished_at: string | null
  result: any
  error: string | null
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [task, setTask] = useState<Task | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    try {
      const [tr, sr] = await Promise.all([
        fetch(`/api/admin/tasks/${id}`),
        fetch(`/api/admin/tasks/${id}/steps`),
      ])
      const tj = await tr.json()
      const sj = await sr.json()
      if (tj.success) setTask(tj.task)
      else setError(tj.error ?? 'task fetch failed')
      if (sj.success) setSteps(sj.steps)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    fetchAll()
    const i = setInterval(fetchAll, 5000)
    return () => clearInterval(i)
  }, [fetchAll])

  async function cancelTask() {
    if (!confirm(`Cancel task ${id.slice(0, 8)}?`)) return
    const r = await fetch(`/api/admin/tasks/${id}/cancel`, { method: 'POST' })
    const j = await r.json()
    if (j.success) fetchAll()
    else alert(`Cancel failed: ${j.error ?? 'unknown'}`)
  }

  async function retryTask() {
    if (!confirm(`Retry task ${id.slice(0, 8)} (creates new enqueue)?`)) return
    const r = await fetch(`/api/admin/tasks/${id}/retry`, { method: 'POST' })
    const j = await r.json()
    if (j.success) {
      alert(`New task enqueued: ${j.task_id}`)
      router.push(`/u/admin/tasks/${j.task_id}`)
    } else {
      alert(`Retry failed: ${j.error ?? 'unknown'}`)
    }
  }

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>
  if (error) return <div className="p-6 text-red-700">Error: {error}</div>
  if (!task) return <div className="p-6 text-gray-500">Task not found</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">任务详情</h1>
          <p className="text-xs text-gray-500 font-mono">{task.task_id}</p>
        </div>
        <div className="space-x-2">
          {(task.status === 'QUEUED' || task.status === 'RUNNING') && (
            <button onClick={cancelTask} className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50">Cancel</button>
          )}
          {(task.status === 'DONE' || task.status === 'FAILED' || task.status === 'CANCELLED' || task.status === 'PARTIAL') && (
            <button onClick={retryTask} className="rounded border border-blue-300 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50">Retry</button>
          )}
          <button onClick={() => router.push('/u/admin/tasks')} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">Back</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">Metadata</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <Field label="task_id" value={task.task_id} mono />
            <Field label="task_type" value={task.task_type} />
            <Field label="status" value={task.status} />
            <Field label="progress" value={`${task.progress ?? 0}%`} />
            <Field label="user_id" value={task.user_id ?? '-'} />
            <Field label="conversation_id" value={task.conversation_id ?? '-'} mono />
            <Field label="parent_task_id" value={task.parent_task_id ?? '-'} mono />
            <Field label="created_at" value={formatTime(task.created_at)} />
            <Field label="started_at" value={task.started_at ? formatTime(task.started_at) : '-'} />
            <Field label="finished_at" value={task.finished_at ? formatTime(task.finished_at) : '-'} />
          </div>
        </section>

        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">Input</h2>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs">{JSON.stringify(task.input, null, 2)}</pre>
        </section>

        {task.result && (
          <section className="rounded border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">Result</h2>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs">{JSON.stringify(task.result, null, 2)}</pre>
          </section>
        )}

        {task.error && (
          <section className="rounded border border-red-200 bg-red-50 p-4">
            <h2 className="text-sm font-semibold text-red-700">Error</h2>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-white p-3 text-xs text-red-900">{JSON.stringify(task.error, null, 2)}</pre>
          </section>
        )}

        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">Steps ({steps.length})</h2>
          {steps.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No steps recorded yet</p>
          ) : (
            <table className="mt-2 min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-gray-600">#</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-600">Description</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-600">Status</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-600">Started</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-600">Finished</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {steps.map((s) => (
                  <tr key={s.step_index}>
                    <td className="px-2 py-1 font-mono">{s.step_index}</td>
                    <td className="px-2 py-1 text-gray-800">{s.description}</td>
                    <td className="px-2 py-1"><StepBadge status={s.status} /></td>
                    <td className="px-2 py-1 text-gray-600">{s.started_at ? formatTime(s.started_at) : '-'}</td>
                    <td className="px-2 py-1 text-gray-600">{s.finished_at ? formatTime(s.finished_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </div>
  )
}

function StepBadge({ status }: { status: StepStatus }) {
  const colorMap: Record<StepStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    RUNNING: 'bg-blue-100 text-blue-800',
    DONE: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    SKIPPED: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colorMap[status]}`}>
      {status}
    </span>
  )
}

function formatTime(s: string): string {
  try {
    return new Date(s).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return s
  }
}
