// ui/src/components/chat/types.ts

export interface PageContextValue {
  brand?:  string;
  store?:  string;
  period?: string;
  page?:   string;
}

export type ChatRole = 'user' | 'assistant';

export interface ToolCallLite {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  durationMs?: number;
}

export type ChatMessage =
  | { type: 'user';           content: string; ts: number }
  | { type: 'assistant_text'; content: string; ts: number }
  | { type: 'tool_call';      call: ToolCallLite; ts: number }
  | { type: 'error';          message: string; ts: number };

export type SseIncoming =
  | { type: 'session';    sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_end';   id: string; name: string; summary?: string; isError?: boolean; durationMs?: number }
  | { type: 'done' }
  | { type: 'error';      message: string };
