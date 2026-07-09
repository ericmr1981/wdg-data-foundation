// Chat↔Agent 通讯协议(Agent 端权威定义)
// 配合: docs/alignment-and-checklist.md §2 + docs/spec-chat-agent.md §A.3 / §A.4

// ─── A→P  (Agent → Portal) ──────────────────────────────

export type AnthropicSDKMessage = unknown  // 用 sdk 0.110+ 自带的类型更精确,这版本先用 unknown 占位
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | unknown[]; is_error?: boolean }

export type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'signature_delta'; signature: string }

export type AnthropicUsage = unknown  // SDK 自己定义

export type ChatErrorCode =
  | 'rate_limit' | 'auth' | 'permission' | 'not_found'
  | 'network' | 'bad_request' | 'refusal' | 'context_overflow'
  | 'protocol_mismatch' | 'unknown' | 'file_too_large'

export type ChatOutgoing =
  | { type: 'hello';     payload: { protocolVersion: 1; sessionId: string } }
  | { type: 'ack';       payload: { messageId: string; ts: number } }
  | { type: 'message_start';        payload: { message: AnthropicSDKMessage } }
  | { type: 'content_block_start'; payload: { index: number; content_block: AnthropicContentBlock } }
  | { type: 'content_block_delta'; payload: { index: number; delta: AnthropicDelta } }
  | { type: 'content_block_stop';  payload: { index: number } }
  | { type: 'message_delta';       payload: { delta: { stop_reason: string | null; stop_sequence?: string }; usage?: AnthropicUsage } }
  | { type: 'message_stop';        payload: Record<string, never> }
  | { type: 'error';     payload: { code: ChatErrorCode; http_status: number; message: string; category?: string; retry_after_ms?: number } }
  | { type: 'interrupted'; payload: { conversationId: string; reason: string } }
  | { type: 'pong';      payload: { ts: number } }

// ─── P→A  (Portal → Agent) ──────────────────────────────

export type ContentBlock = AnthropicContentBlock  // 复用上面的定义

export interface ChatAttachment {
  type: 'file'
  file_id: string
}

export type ChatIncoming =
  | { type: 'auth';           payload: { token: string } }
  | { type: 'user.message';   payload: { conversationId: string; content: ContentBlock[]; messageId: string; brand?: string; attachments?: ChatAttachment[] } }
  | { type: 'user.interrupt'; payload: { conversationId: string; reason?: string } }
  | { type: 'ping';           payload: { ts: number } }

// ─── protocol version ──

export const PROTOCOL_VERSION = 1
