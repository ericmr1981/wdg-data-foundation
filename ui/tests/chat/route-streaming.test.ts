// ui/tests/chat/route-streaming.test.ts
// Mock-based tests for the stream processor extracted from chat/route.ts.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { processStream } from '../../src/lib/chat/stream-processor.ts';

// Helper: build a minimal async iterable from an array of events.
async function* events(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) yield item;
}

test('text-only turn forwards text_delta and sets stop_reason=end_turn', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const result = await processStream(
    events([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '世界' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ]) as AsyncIterable<never>,
    (evt) => sent.push(evt),
    () => {},
  );

  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.usage.input, 100);
  assert.equal(result.usage.output, 5);
  assert.deepEqual(result.assistantTextParts, ['你好', '世界']);
  // Two text_delta SSE events
  const textDeltas = sent.filter(e => e.type === 'text_delta').map(e => e.text);
  assert.deepEqual(textDeltas, ['你好', '世界']);
  // No tool_start emitted
  assert.equal(sent.filter(e => e.type === 'tool_start').length, 0);
});

test('thinking turn forwards thinking_delta per delta and accumulates blocks', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const result = await processStream(
    events([
      { type: 'message_start', message: { usage: { input_tokens: 50 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先想' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '一下' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答:42' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    ]) as AsyncIterable<never>,
    (evt) => sent.push(evt),
    () => {},
  );

  const thinking = sent.filter(e => e.type === 'thinking_delta').map(e => e.text);
  assert.deepEqual(thinking, ['先想', '一下']);
  const text = sent.filter(e => e.type === 'text_delta').map(e => e.text);
  assert.deepEqual(text, ['答:42']);
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.toolUseBlocks.length, 0);
});

test('tool_use block: partial JSON is concatenated and parsed on block stop', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const result = await processStream(
    events([
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'query_brand_stores' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"brand":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"gelatomiiix"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
    ]) as AsyncIterable<never>,
    (evt) => sent.push(evt),
    () => {},
  );

  assert.equal(result.stopReason, 'tool_use');
  assert.equal(result.toolUseBlocks.length, 1);
  assert.deepEqual(result.toolUseBlocks[0], { id: 't1', name: 'query_brand_stores', input: { brand: 'gelatomiiix' } });
  // tool_start was emitted with the parsed input
  const toolStart = sent.find(e => e.type === 'tool_start');
  assert.deepEqual(toolStart, { type: 'tool_start', id: 't1', name: 'query_brand_stores' });
});

test('text_delta callback receives the full text stream', async () => {
  const pieces: string[] = [];
  await processStream(
    events([
      { type: 'message_start', message: { usage: { input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'b' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'c' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
    ]) as AsyncIterable<never>,
    () => {},
    (t) => pieces.push(t),
  );
  assert.deepEqual(pieces, ['a', 'b', 'c']);
});
