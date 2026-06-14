// ui/tests/mcp/all-tools-schema.test.ts
// Tests ALL MCP tools at the schema + registry level — no server needed.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { listToolSchemas } from '../../src/mcp/server.ts';

test('all tools return valid Anthropic-compatible schemas', () => {
  const schemas = listToolSchemas();

  assert.ok(schemas.length >= 46, `expected >= 46 tools, got ${schemas.length}`);

  for (const t of schemas) {
    assert.ok(typeof t.name === 'string' && t.name.length > 0,
      `tool has no name: ${JSON.stringify(t).slice(0, 80)}`);
    assert.ok(typeof t.description === 'string' && t.description.length > 0,
      `${t.name}: missing description`);
    assert.ok(typeof t.input_schema === 'object' && t.input_schema !== null,
      `${t.name}: missing input_schema`);
  }
});

test('no duplicate tool names', () => {
  const schemas = listToolSchemas();
  const names = schemas.map(t => t.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(duplicates, [], `duplicate tool names: ${duplicates.join(', ')}`);
});

test('all tools use valid naming prefix convention', () => {
  const schemas = listToolSchemas();
  const validPrefixes = ['query_', 'get_', 'list_', 'upload_', 'submit_', 'preview_', 'rerun_', 'create_'];

  for (const t of schemas) {
    const hasValidPrefix = validPrefixes.some(p => t.name.startsWith(p));
    assert.ok(hasValidPrefix, `${t.name}: name must start with one of [${validPrefixes.join(', ')}]`);
  }
});

test('financial tools have consistent parameters', () => {
  const schemas = listToolSchemas();
  const finTools = schemas.filter(t => t.name.startsWith('query_financial') || t.name === 'query_financial_statement');

  for (const t of finTools) {
    const props = (t.input_schema as Record<string, unknown>).properties as Record<string, unknown> || {};
    assert.ok('brand' in props || 'period' in props || 'store' in props || 'month' in props,
      `${t.name}: financial tools should have brand/period/store params`);
  }
});

test('every tool description has minimum length', () => {
  const schemas = listToolSchemas();
  for (const t of schemas) {
    assert.ok(t.description.length >= 10,
      `${t.name}: description too short (${t.description.length} chars)`);
  }
});

test('create_store documents service token requirement', () => {
  const schemas = listToolSchemas();
  for (const t of schemas) {
    if (t.name === 'create_store') {
      assert.ok(t.description.includes('service') || t.description.includes('Auth') || t.description.includes('admin'),
        'create_store should document auth requirements');
    }
  }
  // No other tool should leak x-service-token implementation detail
  for (const t of schemas) {
    if (t.name !== 'create_store') {
      assert.ok(!t.description.includes('x-service-token'),
        `${t.name}: should not leak x-service-token in description`);
    }
  }
});

test('no tool description contains yufeng (deprecated brand)', () => {
  const schemas = listToolSchemas();
  for (const t of schemas) {
    assert.ok(!t.description.includes('yufeng'),
      `${t.name}: description must not mention deprecated brand 'yufeng'`);
  }
});
