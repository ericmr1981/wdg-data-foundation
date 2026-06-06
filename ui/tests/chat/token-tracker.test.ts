import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { createTokenTracker, getTokenLimits } from '../../src/lib/chat/token-tracker.ts';

test('initial level is normal with 0 tokens', () => {
  const t = createTokenTracker();
  const { usage, level } = t.record(0, 0);
  assert.equal(level, 'normal');
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
});

test('cumulative tokens stay under soft limit', () => {
  const t = createTokenTracker();
  t.record(30_000, 20_000);
  const { level } = t.record(20_000, 5_000);
  assert.equal(level, 'normal'); // 75K total
  assert.equal(getTokenLimits().soft, 80_000);
});

test('soft limit triggers when cumulative >= 80K', () => {
  const t = createTokenTracker();
  t.record(40_000, 20_000); // 60K
  const { level } = t.record(15_000, 10_000); // +25K = 85K total
  assert.equal(level, 'soft');
});

test('hard limit triggers when cumulative >= 200K', () => {
  const t = createTokenTracker();
  t.record(100_000, 50_000);
  const { level } = t.record(50_000, 5_000); // 205K total
  assert.equal(level, 'hard');
  assert.equal(getTokenLimits().hard, 200_000);
});

test('getUsage returns accumulated totals', () => {
  const t = createTokenTracker();
  t.record(10_000, 5_000);
  t.record(20_000, 15_000);
  const u = t.getUsage();
  assert.equal(u.inputTokens, 30_000);
  assert.equal(u.outputTokens, 20_000);
});
