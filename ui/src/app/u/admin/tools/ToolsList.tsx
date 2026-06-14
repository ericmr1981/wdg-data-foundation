'use client'
import { useState } from 'react'

export default function ToolsList({ tools }: { tools: any[] }) {
  const [list, setList] = useState(tools)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = async (name: string, currentEnabled: boolean) => {
    const r = await fetch(`/api/admin/tools/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentEnabled }),
    })
    if (r.ok) {
      setList(prev => prev.map(t => t.name === name ? { ...t, enabled: !currentEnabled } : t))
    }
  }

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded border border-gray-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">name</th>
            <th className="border p-2 text-left">description</th>
            <th className="border p-2">enabled</th>
            <th className="border p-2">schema</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={4} className="border p-6 text-center text-gray-500">No tools found</td></tr>
          )}
          {list.map((t: any) => (
            <>
              <tr key={t.name} className="hover:bg-gray-50">
                <td className="border p-2 font-mono text-xs">{t.name}</td>
                <td className="border p-2 text-sm">{t.description}</td>
                <td className="border p-2 text-center">
                  <label className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={() => toggle(t.name, t.enabled)}
                    />
                    <span className="ml-1 text-xs">{t.enabled ? '启用' : '禁用'}</span>
                  </label>
                </td>
                <td className="border p-2 text-center">
                  <button onClick={() => toggleExpand(t.name)} className="text-blue-500 text-xs">
                    {expanded.has(t.name) ? '收起' : '查看 schema'}
                  </button>
                </td>
              </tr>
              {expanded.has(t.name) && (
                <tr key={`${t.name}-schema`}>
                  <td colSpan={4} className="border bg-gray-50 p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-xs font-semibold text-gray-700">{t.name} input_schema</span>
                      <button onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(t.inputSchema, null, 2))
                      }} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100">
                        Copy JSON
                      </button>
                    </div>
                    <pre className="rounded bg-gray-100 p-2 text-xs overflow-x-auto max-h-80">
                      {JSON.stringify(t.inputSchema, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
