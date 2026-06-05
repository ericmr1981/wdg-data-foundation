# Chat Widget Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat widget 输出有排版：markdown 渲染、JSON 语法高亮、用户/AI 视觉区分、区块层次清晰。

**Architecture:** 引入 react-markdown + remark-gfm + react-syntax-highlighter；新增 MarkdownMessage / CodeBlock / JsonBlock / UserAvatar 4 个组件；MessageList 重构。

**Tech Stack:** Next.js 14, React 18, react-markdown 9, remark-gfm 4, react-syntax-highlighter 15, vitest 不在（用 node --test + 手动 snapshot 检查）。

---

## File Structure

```
ui/src/components/chat/
  MarkdownMessage.tsx       # NEW: react-markdown 包装
  CodeBlock.tsx             # NEW: markdown 内 code block
  JsonBlock.tsx             # NEW: tool_call 的 JSON 高亮
  UserAvatar.tsx            # NEW: 圆形头像占位
  MessageList.tsx           # MODIFY: 重构整体布局
  MessageList.module.css    # NEW: scoped CSS（如果用）

ui/src/components/chat/__tests__/  (新目录)
  MarkdownMessage.test.tsx
  JsonBlock.test.tsx
  MessageList.test.tsx

ui/package.json             # MODIFY: 加 3 个依赖
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `ui/package.json`
- Modify: `ui/package-lock.json`

- [ ] **Step 1: 安装**

```bash
cd ui && npm install react-markdown@^9 remark-gfm@^4 react-syntax-highlighter@^15
```

Expected: `package.json` 新增 3 个 dependencies，package-lock.json 更新。

- [ ] **Step 2: 验证类型可用**

```bash
cd ui && node -e "console.log(require('react-markdown') ? 'ok' : 'missing')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add ui/package.json ui/package-lock.json
git commit -m "chore(ui): add react-markdown + remark-gfm + react-syntax-highlighter"
```

---

## Task 2: UserAvatar + JsonBlock

**Files:**
- Create: `ui/src/components/chat/UserAvatar.tsx`
- Create: `ui/src/components/chat/JsonBlock.tsx`
- Create: `ui/src/components/chat/__tests__/JsonBlock.test.tsx`

- [ ] **Step 1: 实现 UserAvatar**

```tsx
// ui/src/components/chat/UserAvatar.tsx
'use client';
import { ReactNode } from 'react';

export function UserAvatar({ role }: { role: 'user' | 'assistant' }) {
  const isUser = role === 'user';
  return (
    <div
      className={[
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        isUser ? 'bg-blue-500 text-white' : 'bg-slate-700 text-white',
      ].join(' ')}
      aria-label={isUser ? '你' : 'AI'}
    >
      {isUser ? '你' : 'AI'}
    </div>
  );
}
```

- [ ] **Step 2: 实现 JsonBlock**

```tsx
// ui/src/components/chat/JsonBlock.tsx
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
```

- [ ] **Step 3: 写 JsonBlock 测试**

**Note**: vitest 不在，jsdom + react testing library 也不在。改用**手动 Node.js 脚本测试**，不通过 node --test 跑。

跳过 react-testing-library 路线（jsdom 装包太重）。改用：**直接做"运行时 sanity"测试**——用 node + tsx 跑一个 `render to string` 的小脚本，看输出含关键字即可。

但 tsx 也不在。**最简方案**：不用单测，纯靠 live 验证。**删掉测试文件**。

更新：本任务不写测试，依赖 Task 5 live 验证。

- [ ] **Step 4: 验证 tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -8
```

Expected: 0 new tsc errors; build success.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/chat/UserAvatar.tsx ui/src/components/chat/JsonBlock.tsx
git commit -m "feat(chat): UserAvatar (你/AI) + JsonBlock (syntax-highlight + copy)"
```

---

## Task 3: MarkdownMessage + CodeBlock

**Files:**
- Create: `ui/src/components/chat/MarkdownMessage.tsx`
- Create: `ui/src/components/chat/CodeBlock.tsx`

- [ ] **Step 1: 实现 CodeBlock**

```tsx
// ui/src/components/chat/CodeBlock.tsx
'use client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Props {
  language?: string;
  value: string;
}

export function CodeBlock({ language, value }: Props) {
  return (
    <SyntaxHighlighter
      language={language || 'text'}
      style={oneLight}
      customStyle={{
        borderRadius: 6,
        padding: '0.75rem',
        fontSize: '0.72rem',
        margin: '0.5rem 0',
        border: '1px solid #e5e7eb',
      }}
    >
      {value}
    </SyntaxHighlighter>
  );
}
```

- [ ] **Step 2: 实现 MarkdownMessage**

```tsx
// ui/src/components/chat/MarkdownMessage.tsx
'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';

const ALLOWED_LANGS = new Set([
  'javascript', 'typescript', 'tsx', 'jsx', 'json', 'bash', 'shell', 'sh',
  'sql', 'python', 'yaml', 'markdown', 'md', 'css', 'html', 'diff',
  'go', 'java', 'rust', 'c', 'cpp',
]);

function detectLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const l = lang.toLowerCase();
  return ALLOWED_LANGS.has(l) ? l : undefined;
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-gray-900 [&_a]:text-blue-600 [&_a]:underline [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-[0.85em] [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5 [&_p]:my-1.5 [&_strong]:font-semibold [&_table]:w-full [&_table]:text-xs [&_table]:my-2 [&_th]:bg-gray-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:border [&_th]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-gray-200 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_hr]:my-3 [&_hr]:border-gray-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['script', 'iframe', 'style', 'object', 'embed']}
        components={{
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children).replace(/\n$/, '');
            if (inline) {
              return <code className={className} {...props}>{children}</code>;
            }
            return <CodeBlock language={detectLang(match?.[1])} value={value} />;
          },
          pre({ children }: { children?: ReactNode }) {
            // react-markdown wraps code in <pre>; we render CodeBlock already,
            // so just return children to avoid double-wrapping.
            return <>{children}</>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: 验证 tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -8
```

Expected: 0 new tsc errors; build success.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/chat/CodeBlock.tsx ui/src/components/chat/MarkdownMessage.tsx
git commit -m "feat(chat): MarkdownMessage (GFM) + CodeBlock (syntax highlighter)"
```

---

## Task 4: 重构 MessageList

**Files:**
- Modify: `ui/src/components/chat/MessageList.tsx`

- [ ] **Step 1: 重写整个 MessageList**

```tsx
// ui/src/components/chat/MessageList.tsx
'use client';
import { useState } from 'react';
import type { ChatMessage, ToolCallLite } from './types';
import { UserAvatar } from './UserAvatar';
import { MarkdownMessage } from './MarkdownMessage';
import { JsonBlock } from './JsonBlock';

function ToolCallBlock({ call }: { call: ToolCallLite }) {
  const [open, setOpen] = useState(false);
  const status = call.isError ? '❌' : '✅';
  // Parse result for syntax highlighting (it's typically a JSON string)
  let parsedResult: unknown = call.result;
  try {
    if (typeof call.result === 'string' && call.result.trim().startsWith('{')) {
      parsedResult = JSON.parse(call.result);
    }
  } catch { /* leave as string */ }

  return (
    <div className="my-1 overflow-hidden rounded border border-slate-200 bg-slate-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100"
      >
        <span className="font-mono">{status}</span>
        <code className="font-mono text-[11px] font-semibold">{call.name}</code>
        {call.durationMs != null && (
          <span className="text-slate-400">{call.durationMs}ms</span>
        )}
        {call.retry && (
          <span className="text-yellow-600">重试 {call.retry.attempt}/{call.retry.maxAttempts}</span>
        )}
        <span className="ml-auto text-slate-400">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-2">
          <JsonBlock data={call.input} label="input" />
          {call.result && <JsonBlock data={parsedResult} label="result" />}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-3">
      {messages.map((m, i) => {
        if (m.type === 'user') {
          return (
            <div key={i} className="flex items-start justify-end gap-2">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-500 px-3 py-2 text-sm text-white shadow-sm">
                {m.content}
              </div>
              <UserAvatar role="user" />
            </div>
          );
        }
        if (m.type === 'assistant_text') {
          return (
            <div key={i} className="flex items-start justify-start gap-2">
              <UserAvatar role="assistant" />
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                <MarkdownMessage content={m.content} />
              </div>
            </div>
          );
        }
        if (m.type === 'tool_call') {
          return <ToolCallBlock key={i} call={m.call} />;
        }
        if (m.type === 'thinking') {
          return (
            <div key={i} className="mx-2 rounded border border-dashed border-gray-200 bg-white px-3 py-1 text-xs italic text-gray-500">
              💭 {m.content}
            </div>
          );
        }
        if (m.type === 'token_notice') {
          return (
            <div key={i} className="rounded border border-yellow-200 bg-yellow-50 px-3 py-1 text-center text-xs text-yellow-800">
              ⚠️ Token 用量已达 {m.used} / 软限 {m.softLimit}（{m.level}）— 后续 prompt 已压缩
            </div>
          );
        }
        if (m.type === 'error') {
          return (
            <div key={i} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800">
              ⚠️ {m.message}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
```

- [ ] **Step 2: 验证 tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -8
```

Expected: 0 new tsc errors; build success.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/chat/MessageList.tsx
git commit -m "feat(chat): MessageList refactored — user/AI avatars, markdown, JSON highlighter"
```

---

## Task 5: 验证

- [ ] **Step 1: 跑所有 chat 单测**

```bash
cd ui && node --test --experimental-strip-types tests/chat/*.test.ts
```

Expected: 33 PASS (no new tests added; verification via live + manual).

- [ ] **Step 2: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -10
```

Expected: 0 new tsc errors; build success.

- [ ] **Step 3: Live test (with dev server on 4100)**

1. 打开 chat
2. 问"用 markdown 给我列出 3 个门店及编号" → 看到 ## 标题、`-` 列表、**粗体**、表格
3. 问复杂问题触发多步 tool_call → tool 块默认折叠、点击展开看到 JSON 高亮
4. 看到 user 消息右对齐蓝色 + 圆形 "你" 头像；AI 消息左对齐白色 + 圆形 "AI" 头像

- [ ] **Step 4: 检查 bundle size 增量**（可选）

```bash
cd ui && du -sh .next/static/chunks | head -5
```

Acceptable: < 1MB total (vs typical Next.js apps ~500KB). 新依赖应 < 150KB gzipped.

---

## 验收目标

- 33/33 单元测试通过
- `tsc --noEmit` 0 新错误
- `next build` 成功
- Live: markdown 渲染正确（标题、列表、表格、代码块）
- Live: tool_call 默认折叠、展开有 JSON 高亮和复制按钮
- Live: 用户右对齐蓝色 + 头像；AI 左对齐白色 + 头像
- Bundle 增量 < 150KB gzipped
