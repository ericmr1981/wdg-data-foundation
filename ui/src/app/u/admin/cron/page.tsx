'use client'
import { useEffect, useState, useCallback } from 'react'

interface CronEntry {
  schedule: string
  taskType: string
  metadata: Record<string, any>
}

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每月 1 日 10:00', value: '0 10 1 * *' },
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每 5 分钟', value: '*/5 * * * *' },
]

export default function CronAdminPage() {
  const [entries, setEntries] = useState<CronEntry[]>([])
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<string>('')
  const [editingMode, setEditingMode] = useState<'preset' | 'custom'>('preset')
  const [metadataEditingIdx, setMetadataEditingIdx] = useState<number | null>(null)
  const [metadataText, setMetadataText] = useState<string>('{}')
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [disabled, setDisabled] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const fetchEntries = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/cron')
      const j = await r.json()
      if (j.success) {
        setEntries(j.schedules)
        setLoadError(null)
      } else {
        setLoadError(j.error ?? 'fetch failed')
      }
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  function startEditSchedule(idx: number) {
    setEditingIdx(idx)
    setEditingSchedule(entries[idx].schedule)
    // Detect if this matches a preset
    const preset = CRON_PRESETS.find(p => p.value === entries[idx].schedule)
    setEditingMode(preset ? 'preset' : 'custom')
  }

  function applyPreset(value: string) {
    setEditingSchedule(value)
  }

  function commitSchedule() {
    if (editingIdx === null) return
    const next = [...entries]
    next[editingIdx] = { ...next[editingIdx], schedule: editingSchedule }
    setEntries(next)
    setEditingIdx(null)
    setSaving(true)
    fetch('/api/admin/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules: next }),
    })
      .then((r) => r.json())
      .then((j) => { if (!j.success) alert(`Save failed: ${j.error ?? 'unknown'}`) })
      .catch((e) => alert(`Save failed: ${(e as Error).message}`))
      .finally(() => setSaving(false))
  }

  function startEditMetadata(idx: number) {
    setMetadataEditingIdx(idx)
    setMetadataText(JSON.stringify(entries[idx].metadata, null, 2))
    setMetadataError(null)
  }

  function commitMetadata() {
    if (metadataEditingIdx === null) return
    let parsed: any
    try {
      parsed = JSON.parse(metadataText)
    } catch (e) {
      setMetadataError(`Invalid JSON: ${(e as Error).message}`)
      return
    }
    const next = [...entries]
    next[metadataEditingIdx] = { ...next[metadataEditingIdx], metadata: parsed }
    setEntries(next)
    setMetadataEditingIdx(null)
    setSaving(true)
    fetch('/api/admin/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules: next }),
    })
      .then((r) => r.json())
      .then((j) => { if (!j.success) alert(`Save failed: ${j.error ?? 'unknown'}`) })
      .catch((e) => alert(`Save failed: ${(e as Error).message}`))
      .finally(() => setSaving(false))
  }

  function toggleDisabled(idx: number) {
    const next = new Set(disabled)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setDisabled(next)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Cron Schedule</h1>
        <p className="text-xs text-gray-500">改完需重启 agent 容器 (或 agent 加 hot reload endpoint, v1 暂不支持)</p>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-6">
        {/* Cron vs Task 说明 */}
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold mb-1">Cron 与 任务 (Task) 的区别</p>
          <p><strong>Cron</strong> 是定时触发器（Schedule）。它告诉 agent &ldquo;什么时候&rdquo;自动 enqueue 一个任务。</p>
          <p><strong>任务</strong> (Task) 是执行记录。Cron 触发后，agent 把任务加入队列，开始执行。也可以在 <a href="/u/admin/tasks" className="text-blue-600 underline">/u/admin/tasks</a> 手动 enqueue。</p>
          <p className="mt-1 text-xs">简单说：Cron = 规则 (何时触发) &middot; Task = 结果 (跑了吗？跑过了吗？)</p>
        </div>

        <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900">
          <strong>提示：</strong>当前 agent 端 cron 配置为只读, 改在 <code className="font-mono">.env</code> 文件 (CRON_WEEKLY_REVIEW / CRON_TIMEZONE 等). UI 仅展示 + 标注 enable/disable, 真正修改需重启 agent 进程.
        </div>

        {loadError && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {loadError}
          </div>
        )}

        {saving && (
          <div className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
            Saving...
          </div>
        )}

        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Schedule (cron)</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Task Type</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Metadata</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Enabled</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No cron entries</td></tr>
              )}
              {entries.map((e, idx) => (
                <tr key={idx} className={disabled.has(idx) ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 font-mono text-xs">
                    {editingIdx === idx ? (
                      <div className="flex flex-col gap-1">
                        {/* Preset / Custom toggle */}
                        <div className="flex gap-1 text-xs">
                          <button
                            onClick={() => setEditingMode('preset')}
                            className={`rounded px-2 py-0.5 ${editingMode === 'preset' ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600'}`}
                          >预设</button>
                          <button
                            onClick={() => setEditingMode('custom')}
                            className={`rounded px-2 py-0.5 ${editingMode === 'custom' ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600'}`}
                          >自定义</button>
                        </div>
                        {editingMode === 'preset' ? (
                          <select
                            value={editingSchedule}
                            onChange={(ev) => applyPreset(ev.target.value)}
                            className="w-48 rounded border border-gray-300 px-1 py-0.5 font-mono text-xs"
                          >
                            {CRON_PRESETS.map(p => (
                              <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
                            ))}
                            {/* If current value doesn't match any preset, show it as a custom option */}
                            {!CRON_PRESETS.find(p => p.value === editingSchedule) && (
                              <option value={editingSchedule}>{editingSchedule} (current)</option>
                            )}
                          </select>
                        ) : (
                          <input
                            value={editingSchedule}
                            onChange={(ev) => setEditingSchedule(ev.target.value)}
                            className="w-48 rounded border border-gray-300 px-1 py-0.5 font-mono text-xs"
                            placeholder="e.g. 0 9 * * 1"
                          />
                        )}
                        <div className="flex gap-1">
                          <button onClick={commitSchedule} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">OK</button>
                          <button onClick={() => setEditingIdx(null)} className="rounded border border-gray-300 px-2 py-0.5 text-xs">X</button>
                        </div>
                      </div>
                    ) : (
                      <span>{e.schedule}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-800">{e.taskType}</td>
                  <td className="px-3 py-2 text-xs">
                    <pre className="rounded bg-gray-50 p-1 text-xs">{JSON.stringify(e.metadata, null, 2)}</pre>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!disabled.has(idx)}
                      onChange={() => toggleDisabled(idx)}
                    />
                  </td>
                  <td className="px-3 py-2 space-x-1">
                    <button
                      onClick={() => startEditSchedule(idx)}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                    >Edit schedule</button>
                    <button
                      onClick={() => startEditMetadata(idx)}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                    >Edit metadata</button>
                    <button
                      onClick={() => toggleDisabled(idx)}
                      className={`rounded border px-2 py-0.5 text-xs ${disabled.has(idx) ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-red-300 text-red-700 hover:bg-red-50'}`}
                    >{disabled.has(idx) ? 'Enable' : 'Disable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {metadataEditingIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">Edit Metadata</h2>
            <p className="mt-1 text-xs text-gray-500">Entry #{metadataEditingIdx}</p>
            <textarea
              value={metadataText}
              onChange={(ev) => setMetadataText(ev.target.value)}
              rows={10}
              className="mt-3 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
            {metadataError && (
              <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {metadataError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setMetadataEditingIdx(null); setMetadataError(null) }}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                onClick={commitMetadata}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
              >Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
