// ui/tests/chat/auth.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.
// vitest is not installed; behavior is equivalent to the plan's vitest specs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { filterToolsByRole, isWriteAllowedForRole, ALLOWED_WRITE_TOOLS } from '../../src/lib/chat/auth.ts';

const fakeTools = [
  { name: 'get_brand_stores',          description: 'a', input_schema: {} },
  { name: 'upload_bank_txn_file',      description: 'a', input_schema: {} },
  { name: 'submit_proposal',  description: 'a', input_schema: {} },
  { name: 'rerun_match_by_file',       description: 'a', input_schema: {} },
  { name: 'query_financial_statement', description: 'a', input_schema: {} },
];

test('ALLOWED_WRITE_TOOLS contains the 8 write tools from spec §5', () => {
  assert.deepEqual(
    ALLOWED_WRITE_TOOLS,
    new Set([
      'upload_bank_txn_file',
      'upload_gelatomiiix_income_detail',
      'upload_bonjur_income_detail',
      'upload_bonjur_product_sales',
      'upload_bonjur_sales_self_service',
      'upload_tamkoko_inventory',
      'submit_proposal',
      'rerun_match_by_file',
    ]),
  );
});

test('filterToolsByRole: admin gets all tools', () => {
  const out = filterToolsByRole('admin', fakeTools);
  assert.deepEqual(out.map(t => t.name), fakeTools.map(t => t.name));
});

test('filterToolsByRole: operator drops the 8 write tools, keeps the 2 read tools', () => {
  const out = filterToolsByRole('operator', fakeTools);
  assert.deepEqual(out.map(t => t.name), ['get_brand_stores', 'query_financial_statement']);
});

test('filterToolsByRole: null role same as operator (defense in depth)', () => {
  const out = filterToolsByRole(null, fakeTools);
  assert.deepEqual(out.map(t => t.name), ['get_brand_stores', 'query_financial_statement']);
});

test('isWriteAllowedForRole: admin + whitelisted tool = true', () => {
  assert.equal(isWriteAllowedForRole('admin', 'upload_bank_txn_file'), true);
});

test('isWriteAllowedForRole: admin + non-whitelisted tool = false', () => {
  assert.equal(isWriteAllowedForRole('admin', 'delete_everything'), false);
});

test('isWriteAllowedForRole: operator + whitelisted tool = false', () => {
  assert.equal(isWriteAllowedForRole('operator', 'upload_bank_txn_file'), false);
});

test('isWriteAllowedForRole: null + whitelisted tool = false', () => {
  assert.equal(isWriteAllowedForRole(null, 'upload_bank_txn_file'), false);
});
