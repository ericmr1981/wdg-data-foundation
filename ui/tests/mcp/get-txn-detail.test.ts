import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getTxnDetailTool } from '../../src/mcp/tools/get-txn-detail.ts';

test('get_txn_detail accepts gelatomiiix as brand', () => {
  const result = getTxnDetailTool.inputSchema.safeParse({ bank_txn_id: 1, brand: 'gelatomiiix' });
  assert.ok(result.success);
});

test('get_txn_detail accepts bonjur as brand', () => {
  const result = getTxnDetailTool.inputSchema.safeParse({ bank_txn_id: 1, brand: 'bonjur' });
  assert.ok(result.success);
});

test('get_txn_detail rejects yufeng (deprecated)', () => {
  const result = getTxnDetailTool.inputSchema.safeParse({ bank_txn_id: 1, brand: 'yufeng' });
  assert.equal(result.success, false);
});

test('get_txn_detail defaults brand to gelatomiiix', () => {
  const result = getTxnDetailTool.inputSchema.safeParse({ bank_txn_id: 1 });
  assert.ok(result.success);
  assert.equal(result.data.brand, 'gelatomiiix');
});

test('get_txn_detail requires positive bank_txn_id', () => {
  const result = getTxnDetailTool.inputSchema.safeParse({ bank_txn_id: 0 });
  assert.equal(result.success, false);
});
