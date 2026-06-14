import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  descriptionBlock,
  normalizeQueryResponse,
  normalizeToolResponse,
} from '../../src/mcp/tool-helpers.ts';

test('descriptionBlock formats a labeled text block', () => {
  const desc = descriptionBlock('Parameters', [
    '- brand (required): brand code',
    '- period (required): YYYY-MM',
  ]);
  assert.ok(desc.includes('**Parameters**:'));
  assert.ok(desc.includes('- brand (required): brand code'));
});

test('normalizeQueryResponse returns data when present', () => {
  const result = normalizeQueryResponse({ data: { rows: [] } });
  assert.deepEqual(result, { rows: [] });
});

test('normalizeQueryResponse returns note when no data', () => {
  const result = normalizeQueryResponse({ note: 'view not ready' });
  assert.deepEqual(result, { note: 'view not ready' });
});

test('normalizeQueryResponse falls back to empty note', () => {
  const result = normalizeQueryResponse({});
  assert.deepEqual(result, {});
});

test('normalizeToolResponse extracts known snake_case fields from post response', () => {
  const result = normalizeToolResponse({ file_name: 't.xlsx', file_id: 5 });
  assert.equal(result.fileName, 't.xlsx');
  assert.equal(result.fileId, 5);
});

test('normalizeToolResponse keeps camelCase fields', () => {
  const result = normalizeToolResponse({ fileName: 't.xlsx' });
  assert.equal(result.fileName, 't.xlsx');
});
