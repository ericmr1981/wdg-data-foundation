// ui/src/lib/chat/stream-processor.ts
// Forwarded helper extracted from chat/route.ts for testability.
// Iterates a single Anthropic streaming turn and emits per-event SSE
// payloads via the provided `send` callback. Returns the assembled turn
// state: stop reason, tool-use blocks (with parsed input), text parts,
// and final usage.

import type Anthropic from '@anthropic-ai/sdk';

export interface ProcessStreamResult {
  stopReason: string | null;
  toolUseBlocks: Array<{ id: string; name: string; input: unknown }>;
  assistantTextParts: string[];
  usage: { input: number; output: number };
}

export async function processStream(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  send: (evt: Record<string, unknown>) => void,
  onTextDelta: (t: string) => void,
): Promise<ProcessStreamResult> {
  const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];
  const assistantTextParts: string[] = [];
  let usage = { input: 0, output: 0 };
  let stopReason: string | null = null;

  // Per-block state: index → { type, partialInput (for tool_use) }
  const blocks = new Map<number, { type: 'text' | 'thinking' | 'tool_use'; partialInput?: string; name?: string; id?: string }>();

  for await (const event of stream) {
    if (event.type === 'message_start') {
      usage.input += event.message.usage.input_tokens;
    } else if (event.type === 'content_block_start') {
      const b = event.content_block;
      if (b.type === 'text') {
        blocks.set(event.index, { type: 'text' });
      } else if (b.type === 'thinking') {
        blocks.set(event.index, { type: 'thinking' });
      } else if (b.type === 'tool_use') {
        blocks.set(event.index, { type: 'tool_use', partialInput: '', name: b.name, id: b.id });
      }
    } else if (event.type === 'content_block_delta') {
      const blk = blocks.get(event.index);
      if (!blk) continue;
      if (event.delta.type === 'text_delta' && blk.type === 'text') {
        const t = event.delta.text;
        send({ type: 'text_delta', text: t });
        assistantTextParts.push(t);
        onTextDelta(t);
      } else if (event.delta.type === 'thinking_delta' && blk.type === 'thinking') {
        send({ type: 'thinking_delta', text: event.delta.thinking });
      } else if (event.delta.type === 'input_json_delta' && blk.type === 'tool_use') {
        blk.partialInput = (blk.partialInput ?? '') + event.delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      const blk = blocks.get(event.index);
      if (blk?.type === 'tool_use' && blk.id && blk.name) {
        const input = blk.partialInput ? JSON.parse(blk.partialInput) : {};
        toolUseBlocks.push({ id: blk.id, name: blk.name, input });
        send({ type: 'tool_start', id: blk.id, name: blk.name });
      }
    } else if (event.type === 'message_delta') {
      if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
      if (event.usage.output_tokens) usage.output += event.usage.output_tokens;
    }
  }

  return { stopReason, toolUseBlocks, assistantTextParts, usage };
}
