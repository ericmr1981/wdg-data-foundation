// ui/tests/chat/mcp-bridge.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.
// vitest is not installed; behavior is equivalent to the plan's vitest specs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { toolUseToMcpRequest, parseMcpResult, McpCallError } from '../../src/lib/chat/mcp-bridge.ts';

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
