'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type TaskStatus = 'NEW' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'PARTIAL'
const ALL_STATUSES: TaskStatus[] = ['NEW', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED', 'PARTIAL']

interface Task {
  task_id: string
  task_type: string
  status: TaskStatus
  progress: number
  user_id: string | null
  conversation_id: string | null
  parent_task_id: string | null
  input: any
  result: any
  error: any
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export default function TasksAdminPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [userFilter, setUserFilter] = useState<string>('')

  const [viewTask, setViewTask] = useState<Task | null>(null)
  const [enqueueOpen, setEnqueueOpen] = useState(false)
  const [enqueueType, setEnqueueType] = useState<string>('weekly_bank_review')
  const [enqueueInput, setEnqueueInput] = useState<string>('{}')
  const [enqueueError, setEnqueueError] = useState<string | null>(null)
  const [enqueueSubmitting, setEnqueueSubmitting] = useState(false)

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('task_type', typeFilter)
      if (userFilter) params.set('user_id', userFilter)
      params.set('limit', '100')
      const r = await fetch(`/api/admin/tasks?${params.toString()}`)
      const j = await r.json()
      if (j.success) {
        setTasks(j.tasks)
        setError(null)
      } else {
        setError(j.error ?? 'fetch failed')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter, userFilter])

  useEffect(() => {
    setLoading(true)
    fetchTasks()
    const id = setInterval(fetchTasks, 5000)
    return () => clearInterval(id)
  }, [fetchTasks])

  async function cancelTask(id: string) {
    if (!confirm(`Cancel task ${id.slice(0, 8)}?`)) return
    const r = await fetch(`/api/admin/tasks/${id}/cancel`, { method: 'POST' })
    const j = await r.json()
    if (j.success) fetchTasks()
    else alert(`Cancel failed: ${j.error ?? 'unknown'}`)
  }

  async function retryTask(id: string) {
    if (!confirm(`Retry task ${id.slice(0, 8)} (creates new enqueue)?`)) return
    const r = await fetch(`/api/admin/tasks/${id}/retry`, { method: 'POST' })
    const j = await r.json()
    if (j.success) {
      alert(`New task enqueued: ${j.task_id}`)
      fetchTasks()
    } else {
      alert(`Retry failed: ${j.error ?? 'unknown'}`)
    }
  }

  async function submitEnqueue() {
    setEnqueueError(null)
    let input: any
    try {
      input = JSON.parse(enqueueInput)
    } catch (e) {
      setEnqueueError(`Invalid JSON: ${(e as Error).message}`)
      return
    }
    setEnqueueSubmitting(true)
    try {
      const r = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: enqueueType, input, triggeredBy: 'admin-manual' }),
      })
      const j = await r.json()
      if (j.success) {
        setEnqueueOpen(false)
        setEnqueueInput('{}')
        fetchTasks()
      } else {
        setEnqueueError(j.error ?? 'enqueue failed')
      }
    } catch (e) {
      setEnqueueError((e as Error).message)
    } finally {
      setEnqueueSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">任务管理</h1>
          <p className="text-xs text-gray-500">查看 / 取消 / 重试 / 手动入队 agent 任务 · 每 5 秒自动刷新</p>
        </div>
        <button
          onClick={() => setEnqueueOpen(true)}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Enqueue
        </button>
      </header>

      <main className="mx-auto max-w-7xl p-6 space-y-4">
        <div className="flex flex-wrap gap-3 rounded border border-gray-200 bg-white p-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">(all)</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Task Type:</span>
            <input
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              placeholder="weekly_bank_review"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">User ID:</span>
            <input
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder="alice"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            onClick={fetchTasks}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Task ID</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Type</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Progress</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">User</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Created</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Finished</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Loading...</td></tr>
              )}
              {!loading && tasks.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No tasks</td></tr>
              )}
              {tasks.map((t) => (
                <tr key={t.task_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{t.task_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-gray-800">{t.task_type}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-2 text-gray-700">{t.progress ?? 0}%</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{t.user_id ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{formatTime(t.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{t.finished_at ? formatTime(t.finished_at) : '-'}</td>
                  <td className="px-3 py-2 space-x-1">
                    <button
                      onClick={() => setViewTask(t)}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                    >View</button>
                    <Link
                      href={`/u/admin/tasks/${t.task_id}`}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                    >Steps</Link>
                    {(t.status === 'QUEUED' || t.status === 'RUNNING') && (
                      <button
                        onClick={() => cancelTask(t.task_id)}
                        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                      >Cancel</button>
                    )}
                    {(t.status === 'DONE' || t.status === 'FAILED' || t.status === 'CANCELLED' || t.status === 'PARTIAL') && (
                      <button
                        onClick={() => retryTask(t.task_id)}
                        className="rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                      >Retry</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {viewTask && (
        <TaskDetailModal task={viewTask} onClose={() => { setViewTask(null); fetchTasks() }} />
      )}

      {enqueueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">Enqueue Task</h2>
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                <span className="text-gray-700">Task Type</span>
                <input
                  value={enqueueType}
                  onChange={(e) => setEnqueueType(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-700">Input (JSON)</span>
                <textarea
                  value={enqueueInput}
                  onChange={(e) => setEnqueueInput(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                />
              </label>
              {enqueueError && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  {enqueueError}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEnqueueOpen(false)}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                onClick={submitEnqueue}
                disabled={enqueueSubmitting}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >{enqueueSubmitting ? 'Submitting...' : 'Submit'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const colorMap: Record<TaskStatus, string> = {
    NEW: 'bg-gray-100 text-gray-700',
    QUEUED: 'bg-yellow-100 text-yellow-800',
    RUNNING: 'bg-blue-100 text-blue-800',
    DONE: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-100 text-gray-500',
    PARTIAL: 'bg-orange-100 text-orange-800',
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

function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">Task Detail</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-gray-500">task_id:</span> <span className="font-mono">{task.task_id}</span></div>
          <div><span className="text-gray-500">task_type:</span> {task.task_type}</div>
          <div><span className="text-gray-500">status:</span> <StatusBadge status={task.status} /></div>
          <div><span className="text-gray-500">progress:</span> {task.progress ?? 0}%</div>
          <div><span className="text-gray-500">user_id:</span> {task.user_id ?? '-'}</div>
          <div><span className="text-gray-500">conversation_id:</span> {task.conversation_id ?? '-'}</div>
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">Input</h3>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(task.input, null, 2)}</pre>
        </div>
        {task.result && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-gray-700">Result</h3>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(task.result, null, 2)}</pre>
          </div>
        )}
        {task.error && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-red-700">Error</h3>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-red-50 p-2 text-xs text-red-900">{JSON.stringify(task.error, null, 2)}</pre>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}
