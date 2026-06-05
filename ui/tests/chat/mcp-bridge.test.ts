// ui/tests/chat/mcp-bridge.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.
// vitest is not installed; behavior is equivalent to the plan's vitest specs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { toolUseToMcpRequest, parseMcpResult, McpCallError, callMcpWithRetry } from '../../src/lib/chat/mcp-bridge.ts';

test('toolUseToMcpRequest builds a valid JSON-RPC 2.0 tools/call envelope', () => {
  const out = toolUseToMcpRequest('tool_42', 'get_brand_stores', { brand: 'bonjur' }, 7);
  assert.deepEqual(out, {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'get_brand_stores', arguments: { brand: 'bonjur' } },
  });
});

test('parseMcpResult extracts text content from a successful response', () => {
  const r = parseMcpResult({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: '{"brands":[]}' }] },
  });
  assert.deepEqual(r, { ok: true, text: '{"brands":[]}' });
});

test('parseMcpResult returns an McpCallError on JSON-RPC error', () => {
  const r = parseMcpResult({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32602, message: 'Invalid params' },
  });
  assert.ok(r instanceof McpCallError);
  assert.equal(r.message, 'Invalid params');
});

test('callMcpWithRetry returns immediately on success', async () => {
  // Mock global.fetch
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
  }) as typeof fetch;
  const onRetry = () => { throw new Error('should not be called'); };
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x', onRetry, 2,
    );
    assert.equal(calls, 1);
    assert.equal((r as { ok: true; text: string }).text, 'ok');
  } finally { global.fetch = original; }
});

test('callMcpWithRetry retries on 5xx', async () => {
  const original = global.fetch;
  let calls = 0;
  const retries: number[] = [];
  global.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response('boom', { status: 503 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
  }) as typeof fetch;
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x',
      (a) => retries.push(a), 2,
    );
    assert.equal(calls, 2);
    assert.deepEqual(retries, [1]);
    assert.equal((r as { ok: true; text: string }).text, 'ok');
  } finally { global.fetch = original; }
});

test('callMcpWithRetry does NOT retry on 4xx', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return new Response('bad', { status: 400 });
  }) as typeof fetch;
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x',
      () => { throw new Error('should not retry on 4xx'); }, 2,
    );
    assert.equal(calls, 1);
    assert.ok(r instanceof McpCallError);
    assert.equal((r as McpCallError).code, 400);
  } finally { global.fetch = original; }
});

test('callMcpWithRetry gives up after maxAttempts on 5xx', async () => {
  const original = global.fetch;
  let calls = 0;
  const retries: number[] = [];
  global.fetch = (async () => {
    calls++;
    return new Response('boom', { status: 503 });
  }) as typeof fetch;
  try {
    const r = await callMcpWithRetry(
      { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      null, 'http://x',
      (a) => retries.push(a), 2,
    );
    assert.equal(calls, 2);
    assert.deepEqual(retries, [1]); // only 1 retry (attempt 1 failed, attempt 2 failed)
    assert.ok(r instanceof McpCallError);
  } finally { global.fetch = original; }
});
