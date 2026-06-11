// ui/src/components/chat/ChatInput.tsx
'use client';
import { useState, KeyboardEvent, useRef } from 'react';

interface Props {
  onSend: (text: string, file?: File) => void;
  onReset?: () => void;
  disabled?: boolean;
  canUpload?: boolean;  // false for non-admin
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export function ChatInput({ onSend, onReset, disabled, canUpload = true }: Props) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function send() {
    const t = text.trim();
    if (!t && !file) return;
    onSend(t, file ?? undefined);
    setText('');
    setFile(null);
    setFileError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setFileError(`不支持的文件类型: ${ext}（仅支持 .csv/.xlsx/.xls）`);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError(`文件过大: ${(f.size / 1024 / 1024).toFixed(1)}MB（上限 20MB）`);
      return;
    }
    setFile(f);
    setFileError(null);
    // Pre-fill a default message so the user can just press Enter
    if (!text.trim()) {
      setText(`请分析这个文件: ${f.name}`);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white p-2">
      {fileError && (
        <div className="text-xs text-red-600 mb-1">{fileError}</div>
      )}
      {file && (
        <div className="text-xs text-blue-600 mb-1 flex items-center gap-2">
          <span>📎 {file.name} ({(file.size / 1024).toFixed(1)}KB)</span>
          <button
            type="button"
            onClick={() => { setFile(null); setFileError(null); }}
            className="text-gray-400 hover:text-gray-600"
          >✕</button>
        </div>
      )}
      <textarea
        rows={2}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="问点什么…(Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        className="w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={!canUpload}
            onClick={() => fileInputRef.current?.click()}
            title={canUpload ? '上传文件（银行流水/收入明细/库存等）' : '权限不足'}
            className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >📎 上传</button>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={disabled || (!text.trim() && !file)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >发送</button>
      </div>
    </div>
  );
}
