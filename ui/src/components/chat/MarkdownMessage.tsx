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

/**
 * Convert markdown table lines to bullet-point list format.
 * This avoids broken table rendering when streamed content splits rows
 * across multiple text_block events.
 *
 * Input: "| 营业收入 | 16.58万元 | ↑13.33万 |"
 * Output: "• 营业收入 — 16.58万元 — ↑13.33万"
 */
function preprocessTables(text: string): string {
  // Match table lines: lines starting with | (header, separator, or data rows)
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    // Check if this looks like a table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)           // remove leading/trailing |
        .split('|')
        .map(s => s.trim())
        .filter(Boolean);

      // Separator row (|:--|:--|) — skip entirely
      if (cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c))) {
        return '';
      }

      // Header row — bold it
      if (cells.length > 0) {
        return '• **' + cells.join('** — **') + '**';
      }
    }
    return line;
  }).join('\n');
}

export function MarkdownMessage({ content }: { content: string }) {
  const processed = preprocessTables(content);
  return (
    <div className="prose prose-sm max-w-none break-words text-gray-900 [&_a]:text-blue-600 [&_a]:underline [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-[0.85em] [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5 [&_p]:my-1.5 [&_strong]:font-semibold [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_hr]:my-3 [&_hr]:border-gray-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['script', 'iframe', 'style', 'object', 'embed', 'table']}
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
            return <>{children}</>;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
