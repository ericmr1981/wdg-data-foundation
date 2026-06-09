// ui/src/lib/mcp-service-token.test.ts
// Unit tests for the two early-return paths of verifyMcpServiceToken.
// The DB path is exercised end-to-end via curl in the plan's smoke step.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { verifyMcpServiceToken } from './mcp-service-token.ts';

test('returns false when no token provided (empty string)', async () => {
  assert.equal(await verifyMcpServiceToken(''), false);
});

test('returns false when WDG_SERVICE_TOKEN env is not set', async () => {
  const prev = process.env.WDG_SERVICE_TOKEN;
  delete process.env.WDG_SERVICE_TOKEN;
  try {
    assert.equal(await verifyMcpServiceToken('any-token-here'), false);
  } finally {
    if (prev !== undefined) process.env.WDG_SERVICE_TOKEN = prev;
  }
});
