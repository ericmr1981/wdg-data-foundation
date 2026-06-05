'use client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useState } from 'react';

interface Props {
  data: unknown;
  label?: string;
}

export function JsonBlock({ data, label }: Props) {
  const [copied, setCopied] = useState(false);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="my-1">
      {label && <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">{label}</div>}
      <div className="relative">
        <SyntaxHighlighter
          language="json"
          style={oneLight}
          customStyle={{
            borderRadius: 6,
            padding: '0.75rem',
            fontSize: '0.72rem',
            margin: 0,
            border: '1px solid #e5e7eb',
          }}
        >
          {text}
        </SyntaxHighlighter>
        <button
          type="button"
          onClick={copy}
          className="absolute right-2 top-2 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50"
        >
          {copied ? '✓ 已复制' : '📋 复制'}
        </button>
      </div>
    </div>
  );
}
