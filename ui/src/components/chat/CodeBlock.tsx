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
