'use client';
import { useState, useEffect } from 'react';
import { buildSystemPrompt, type ToolSchemaLite } from '@/lib/chat/prompt';

export function AgentConfigPreview({ agentMd }: { agentMd: string }) {
  const [preview, setPreview] = useState('');

  useEffect(() => {
    const sampleTools: ToolSchemaLite[] = [
      { name: 'get_brand_stores', description: 'sample', input_schema: {} },
    ];
    try {
      const p = buildSystemPrompt({}, sampleTools, { customInstructions: agentMd });
      setPreview(p.slice(0, 3000) + (p.length > 3000 ? '\n\n... (截断显示)' : ''));
    } catch (e) {
      setPreview('预览失败: ' + (e as Error).message);
    }
  }, [agentMd]);

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">预览拼出的 system prompt（前 3000 字符）</summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs">{preview}</pre>
    </details>
  );
}
