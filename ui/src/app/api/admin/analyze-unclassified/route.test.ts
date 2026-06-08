// ui/src/app/api/admin/analyze-unclassified/route.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { parseInput } from '../../../../lib/analyze-unclassified.pure.ts';

test('parseInput rejects unknown brand', () => {
  const r = parseInput({ brand: 'unknown', limit: 10 });
  assert.ok('error' in r);
  assert.match((r as { error: string }).error, /unknown brand/);
});

test('parseInput rejects limit > 50', () => {
  const r = parseInput({ brand: 'tamkoko', limit: 100 });
  assert.ok('error' in r);
});

test('parseInput accepts valid input', () => {
  const r = parseInput({ brand: 'tamkoko', limit: 30, unclassified_txn_ids: [1, 2, 3] });
  assert.ok(!('error' in r));
  assert.equal((r as { brand: string }).brand, 'tamkoko');
  assert.equal((r as { limit: number }).limit, 30);
});

test('parseInput rejects non-integer txn ids', () => {
  const r = parseInput({ brand: 'tamkoko', unclassified_txn_ids: [1.5, 'x'] });
  assert.ok('error' in r);
});
