// ui/src/components/chat/ChatInput.tsx
'use client';
import { useState, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  onReset: () => void;
  disabled?: boolean;
  canUpload?: boolean;  // false for non-admin
}

export function ChatInput({ onSend, onReset, disabled, canUpload = true }: Props) {
  const [text, setText] = useState('');

  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white p-2">
      <textarea
        rows={2}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="问点什么…(Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        className="w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={!canUpload}
            title={canUpload ? '上传文件（暂未启用）' : '权限不足'}
            className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >📎 上传</button>
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50"
          >🔄 重启</button>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={disabled || !text.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >发送</button>
      </div>
    </div>
  );
}
