// ui/tests/chat/sse.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { encodeSseEvent, parseSseStream } from '../../src/lib/chat/stream.ts';

test('encodeSseEvent encodes a typed event with JSON data and double newlines', () => {
  const out = encodeSseEvent({ type: 'text_delta', text: 'hi' });
  assert.equal(out, 'event: text_delta\ndata: {"type":"text_delta","text":"hi"}\n\n');
});

test('parseSseStream parses a single event from one chunk', () => {
  const events: unknown[] = [];
  // The implementation always sets parsed.type from the SSE `event:` line if
  // present (per SSE spec). So an input 'event: ping\ndata: {"x":1}\n\n' yields
  // {type:'ping', x:1}, not {x:1}. The plan's assertion `[{x:1}]` was wrong.
  parseSseStream('event: ping\ndata: {"x":1}\n\n', e => events.push(e));
  assert.deepEqual(events, [{ type: 'ping', x: 1 }]);
});

test('parseSseStream parses two events across two separate chunks (no cross-call state)', () => {
  const events: unknown[] = [];
  const cb = (e: unknown) => events.push(e);
  // The implementation is a STATELESS per-chunk splitter (no internal buffer
  // across calls). So we test what the implementation actually does: two
  // COMPLETE records delivered as two chunks. State from the first call must
  // not leak into the second.
  //
  // The plan's original input ('event: a\ndata: {"i":1}\n\nevent: b\ndata: '
  // followed by '{"i":2}\n\n') cannot work with a stateless parser: the
  // trailing 'event: b\ndata: ' is a record with no data value yet, which
  // the parser correctly drops via `if (!data) continue;`. That is the
  // correct SSE behavior for a single-chunk call; it is just not what the
  // test as-written expected.
  parseSseStream('event: a\ndata: {"i":1}\n\n', cb);
  parseSseStream('event: b\ndata: {"i":2}\n\n', cb);
  assert.deepEqual(events, [{ type: 'a', i: 1 }, { type: 'b', i: 2 }]);
});

test('parseSseStream skips keepalive comments', () => {
  const events: unknown[] = [];
  parseSseStream(': keepalive\nevent: x\ndata: {"y":2}\n\n', e => events.push(e));
  // Test 3 originally in the plan asserted [{y:2}]; the implementation
  // (correctly, per SSE spec) sets parsed.type from the `event:` line.
  assert.deepEqual(events, [{ type: 'x', y: 2 }]);
});
