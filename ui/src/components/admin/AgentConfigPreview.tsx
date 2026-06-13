'use client';
import { useState, useEffect } from 'react';
import { buildSystemPrompt, type ToolSchemaLite } from '@/lib/chat/prompt';

/**
 * 近似估算 token 数:
 *  - 英文 1 token ≈ 4 字符 (cl100k_base 经验值)
 *  - 中文 1 token ≈ 1.5 字符 (cl100k_base 中文密度高, ~0.67 token/字符)
 *  - JSON 结构 (符号) 损耗 ~10%
 * 误差 ±15%, 够用作 UI 反馈. 真 LLM 调用时仍以 SDK 返回 usage 为准.
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  let en = 0
  let cn = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code >= 0x4e00 && code <= 0x9fff) cn++
    else if ((code >= 0x30 && code <= 0x7e) || (code >= 0x20 && code <= 0x7e)) en++
    else other++
  }
  const base = en / 4 + cn / 1.5 + other / 3
  return Math.ceil(base * 1.1)  // 符号损耗
}

export function AgentConfigPreview({ agentMd }: { agentMd: string }) {
  const [preview, setPreview] = useState('');
  const [tokens, setTokens] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [copied, setCopied] = useState(false);
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
      const full = header + p
      setPreview(full)
      setBytes(new TextEncoder().encode(full).length)
      setTokens(estimateTokens(full))
    } catch (e) {
      setPreview('预览失败: ' + (e as Error).message);
      setTokens(0)
      setBytes(0)
    }
  }, [agentMd, realTools]);

  // 把完整内容写到剪贴板的辅助函数
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(preview)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.warn('copy failed:', e)
    }
  }

  // token 用量提示 (cl100k_base 估算, 误差 ±15%)
  const TOKEN_SOFT = 80000
  const TOKEN_HARD = 200000
  const tokenWarn = tokens > TOKEN_SOFT ? '⚠️' : ''
  const tokenColor =
    tokens > TOKEN_HARD ? 'text-red-600' :
    tokens > TOKEN_SOFT ? 'text-yellow-600' :
    'text-gray-500'

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">
        预览拼出的 system prompt（完整内容，可滚动）
      </summary>
      <div className="mt-2">
        {/* token 用量条 */}
        <div className="flex justify-between items-center mb-2 px-1 text-xs">
          <div className={tokenColor}>
            <span className="font-semibold">约 {tokens.toLocaleString()} tokens</span>
            {' '}
            <span className="text-gray-400">({(bytes / 1024).toFixed(1)} KB)</span>
            {tokenWarn && <span className="ml-2">⚠️ 超过软上限 {TOKEN_SOFT.toLocaleString()}, 注意 token 消耗</span>}
          </div>
          <button
            onClick={copyToClipboard}
            className="rounded bg-white border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            {copied ? '✅ 已复制' : '📋 复制完整内容'}
          </button>
        </div>
        <pre className="max-h-[40rem] overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed">
          {preview}
        </pre>
        {/* token 上下文参考 */}
        <div className="mt-1 text-[10px] text-gray-400 px-1">
          参考: tokenSoftLimit = {TOKEN_SOFT.toLocaleString()} · tokenHardLimit = {TOKEN_HARD.toLocaleString()} (在 admin/agent-config 可改)
          · 估算方式: 英文 ≈ 4 字符/token, 中文 ≈ 1.5 字符/token, ±15% 误差
        </div>
      </div>
    </details>
  );
}
