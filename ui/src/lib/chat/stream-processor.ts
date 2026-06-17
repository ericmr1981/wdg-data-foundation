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

// ASCII control characters that break JSON.parse (i.e. not \t \n \r).
// These can sneak into tool_use input JSON when the model emits literal
// control bytes. We strip them before parsing.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Strip spaces between CJK characters inserted by the tokenizer. */
function stripCjkSpaces(t: string): string {
  // Match CJK Unified Ideographs (U+4E00–U+9FFF, U+3400–U+4DBF, U+F900–U+FAFF)
  // followed by whitespace followed by another CJK char.
  let out = '', i = 0;
  while (i < t.length) {
    const cp = t.charCodeAt(i);
    const isCjk = (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0xF900 && cp <= 0xFAFF);
    if (isCjk && i + 1 < t.length && (t[i + 1] === ' ' || t[i + 1] === '　')) {
      const cp2 = t.charCodeAt(i + 2);
      const isCjk2 = (cp2 >= 0x4E00 && cp2 <= 0x9FFF) || (cp2 >= 0x3400 && cp2 <= 0x4DBF) || (cp2 >= 0xF900 && cp2 <= 0xFAFF);
      if (isCjk2) {
        out += t[i]; i++;
        i++; // skip the space
        continue;
      }
    }
    out += t[i]; i++;
  }
  return out;
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
        const t = stripCjkSpaces(event.delta.text);
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
        const raw = blk.partialInput ?? '';
        const cleaned = raw.replace(CONTROL_CHARS_RE, '');
        let input: unknown = {};
        try {
          input = cleaned ? JSON.parse(cleaned) : {};
        } catch (err) {
          input = { _raw: cleaned, _parse_error: (err as Error).message };
        }
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
