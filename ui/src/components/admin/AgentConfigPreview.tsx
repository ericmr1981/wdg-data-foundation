'use client';
import { useState, useEffect } from 'react';
import { buildSystemPrompt, type ToolSchemaLite } from '@/lib/chat/prompt';

export function AgentConfigPreview({ agentMd }: { agentMd: string }) {
  const [preview, setPreview] = useState('');
  const [realTools, setRealTools] = useState<ToolSchemaLite[] | null>(null);

  // 实时从 /api/admin/tools 拉 46 个工具 (跟 /u/admin/tools 页同源)
  useEffect(() => {
    fetch('/api/admin/tools')
      .then(r => r.json())
      .then(d => {
        const enabled = (d.tools ?? []).filter((t: any) => t.enabled)
        const realList: ToolSchemaLite[] = enabled.map((t: any) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }))
        setRealTools(realList)
      })
      .catch(() => setRealTools([]))
  }, []);

  useEffect(() => {
    // 没拉到时用 sample 1 个 (保持预览不崩)
    const tools = realTools ?? [
      { name: 'get_brand_stores', description: 'sample', input_schema: {} },
    ]
    const n = realTools?.length ?? 1
    try {
      const p = buildSystemPrompt({}, tools, { customInstructions: agentMd })
      const header = `> ℹ️ 实际生效 ${n} 个工具 (来自 /api/admin/tools，已过滤 enabled) + 1 个 load_skill 内部工具\n\n`
      setPreview(header + p.slice(0, 3000) + (p.length > 3000 ? '\n\n... (截断显示)' : ''))
    } catch (e) {
      setPreview('预览失败: ' + (e as Error).message);
    }
  }, [agentMd, realTools]);

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">
        预览拼出的 system prompt（前 3000 字符）
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs">
        {preview}
      </pre>
    </details>
  );
}
