# Chat Widget Layout & Formatting Refactor Design

## 1. 概述

当前 chat widget 的 `MessageList.tsx` 把所有消息用 `<pre>` 平铺、纯文本显示。Claude 的 markdown 回复（**bold**、`##` 标题、列表、表格、代码块）都显示成原始字符。Tool call 的 JSON 输入输出也很难读。本期重构排版，达到"真正像 IDE 工具栏"的可读性。

## 2. 范围

### 包含
- **Markdown 渲染**：assistant_text 通过 `react-markdown` + `remark-gfm` 渲染（支持 GFM 表格、任务列表、`---` 分隔线）
- **代码高亮**：tool_call 的 input/result JSON 用 `react-syntax-highlighter` 着色（key 蓝、string 绿、number 黄）
- **区块视觉层次**：每种消息类型有独立样式（用户/AI/思考/工具/警告/Token）
- **用户消息右对齐 + 头像占位**：用户消息右对齐、蓝色背景、圆形 👤 头像；AI 消息左对齐、白色背景、圆形 🤖 头像
- **tool_call 折叠优化**：默认折叠、展开后 JSON 语法高亮 + "复制" 按钮 + "重试/耗时" 元数据行
- **Codeblock in markdown**：Claude 回复里的 ```code blocks``` 也用 syntax highlighter 渲染

### 不包含
- 用户头像真实化（不读 user 表里的头像；用 emoji 占位）
- AI 头像真实化（同上）
- 消息发送时间戳（避免视觉杂乱；hover 时显示）
- Markdown 编辑器（chat 是输出 only）
- 暗色模式（保持浅色）
- Tailwind 之外的 CSS-in-JS 库

## 3. 依赖

新增 3 个 npm 包：
- `react-markdown@^9` — markdown 渲染
- `remark-gfm@^4` — GFM 扩展（表格、任务列表、删除线）
- `react-syntax-highlighter@^15` — 代码高亮
- `rehype-raw`（可选，不在本期）

预估 bundle 增加：~80-120KB gzipped（react-markdown 主导）。

## 4. 组件设计

### 4.1 新文件

```
ui/src/components/chat/
  MarkdownMessage.tsx        # 包装 react-markdown，定义 prose 样式
  JsonBlock.tsx             # 包装 react-syntax-highlighter，渲染 JSON with 语言 'json'
  CodeBlock.tsx             # 包装 react-syntax-highlighter，用于 markdown 内的代码块
  UserAvatar.tsx            # 圆形头像占位 (👤 / 🤖)
  MessageList.tsx           # MODIFY: 整体重排版
  ChatWidget.tsx            # 微调（如果需要）
```

### 4.2 视觉规范

| 消息类型 | 对齐 | 背景 | 头像 | 边框 | 字号 |
|---|---|---|---|---|---|
| `user` | 右 | bg-blue-500 text-white | 👤 圆形 | rounded-2xl | text-sm |
| `assistant_text` | 左 | bg-white | 🤖 圆形 | rounded-2xl shadow-sm | text-sm |
| `thinking` | 左 | bg-gray-50 border-dashed | (无) | rounded italic text-gray-500 | text-xs |
| `tool_call` | 左 | bg-slate-50 | (无) | rounded border | text-xs |
| `token_notice` | 居中 (满宽) | bg-yellow-50 | (无) | border-yellow-200 | text-xs |
| `error` | 居中 (满宽) | bg-red-50 | (无) | border-red-200 | text-xs |

### 4.3 MarkdownMessage 关键配置

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    code: CodeBlock,         // 自定义：检测 language，用 syntax-highlighter
    a: MarkdownLink,         // target=_blank rel=noopener
    table: MarkdownTable,    // 紧凑表格样式
  }}
>
  {content}
</ReactMarkdown>
```

Tailwind `@tailwindcss/typography` 提供 `.prose` 样式。如果不想加新依赖，手写一个 `chat-prose.css` 覆盖 `h1/h2/p/ul/ol/blockquote/code/pre/table` 的样式。

**决定**：不引入 `@tailwindcss/typography`（避免全局样式冲突），手写 scoped CSS。

### 4.4 CodeBlock 关键设计

```tsx
<SyntaxHighlighter
  language={inline ? undefined : (lang || 'text')}
  style={oneDark}  // 用 oneDark 主题（已读性高、对比度好）
  customStyle={{ borderRadius: 6, padding: '0.75rem', fontSize: '0.75rem' }}
>
  {value}
</SyntaxHighlighter>
```

- inline code → 简单 `<code>` 元素，背景灰、padding 1px 3px
- block code → SyntaxHighlighter

### 4.5 JsonBlock 关键设计

```tsx
<JsonBlock data={call.input} collapsed={!open} />
<JsonBlock data={call.result} collapsed={!open} />
```

- 自动 `JSON.stringify(data, null, 2)`
- 语言 `json`（自动加语法高亮）
- 折叠时显示 "input (3 fields, 142 chars) · 点击展开"
- 展开后有 "复制" 按钮

### 4.6 ToolCallBlock 重构

```
┌────────────────────────────────────────┐
│ ▶ ✅ get_brand_stores         12ms      │  ← 默认折叠
│   [重试 1/2]                              │  ← 重试时显示
└────────────────────────────────────────┘
展开后：
┌────────────────────────────────────────┐
│ ▼ ✅ get_brand_stores         12ms     │
│   input:                                 │
│   { "brand": "bonjur" }   [📋 复制]    │  ← JSON 高亮
│   result:                                │
│   { "brands": [...] }      [📋 复制]    │
└────────────────────────────────────────┘
```

## 5. 测试

### 5.1 单元测试（vitest 不在；用 react-testing-library + jsdom）

新增 `ui/tests/chat/MarkdownMessage.test.tsx`：
- 渲染 ## 标题 → <h2>
- 渲染 **bold** → <strong>
- 渲染 `inline code` → <code>
- 渲染 ```code block``` → syntax-highlighter 调用
- 渲染 GFM 表格 → <table>
- 链接有 target=_blank

新增 `ui/tests/chat/JsonBlock.test.tsx`：
- `JSON.stringify({a: 1})` → 含 "{ "a": 1 }" 字符串
- 复制按钮 onClick 调 navigator.clipboard.writeText

`MessageList.test.tsx`（新）：
- 5 种消息类型各自的 DOM 结构（getByText、getByRole）
- user 消息右对齐（className 含 `justify-end`）
- assistant 左对齐（className 含 `justify-start`）

### 5.2 验收

- 33 + N 个新单测全过
- `next build` 成功
- Live: Claude 写"## 营收概览\n\n| 门店 | 营收 |\n| --- | --- |\n| wz_ra | 100万 |" → UI 渲染成真表格
- Live: tool_call 块默认折叠、点击展开看到 JSON 高亮
- Live: 用户消息右对齐蓝色，AI 消息左对齐白色

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| react-markdown 增加 bundle ~80KB | 评估：chat 路由 lazy-load 不合适（widget 全局），可以接受。功能价值高。 |
| 大量 markdown 文本影响性能 | ReactMarkdown 自带虚拟化（按段落渲染），OK |
| syntax-highlighter 用 oneDark 在浅色背景下对比度低 | 用 oneLight（浅色）主题 |
| 用户/AI 头像 emoji 在不同 OS 显示不一致 | 用圆形 div + 文字 "你" / "AI"，不依赖 emoji |
| react-markdown 默认允许 HTML 注入 | 在 components 里覆盖 a/code/pre，禁止原始 HTML（用 `disallowedElements: ['script', 'iframe']`） |

## 7. 文件清单

**新增**（4-5 个）：
- `ui/src/components/chat/MarkdownMessage.tsx`
- `ui/src/components/chat/CodeBlock.tsx`
- `ui/src/components/chat/JsonBlock.tsx`
- `ui/src/components/chat/UserAvatar.tsx`
- `ui/src/components/chat/MessageList.module.css` （如不用 tailwind）
- `ui/tests/chat/MarkdownMessage.test.tsx`
- `ui/tests/chat/JsonBlock.test.tsx`
- `ui/tests/chat/MessageList.test.tsx`

**修改**（3 个）：
- `ui/package.json` — 加依赖
- `ui/src/components/chat/MessageList.tsx` — 重构
- `ui/src/components/chat/ChatWidget.tsx` — 微调（如有）

## 8. 验收目标

- 单元测试 + 33 = 38+ 全过
- `tsc --noEmit` 0 新错误
- `next build` 成功
- Live 视觉升级：表格、代码、列表都正确渲染；用户/AI 区分明显
- Bundle 增量 < 150KB gzipped
