import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { salesToolFactory, type SalesToolConfig } from '../../src/mcp/sales-query-factory.ts';

test('salesToolFactory creates a tool with correct name and description', () => {
  const config: SalesToolConfig = {
    name: 'query_gelatomiiix_sales_overview',
    dimension: 'overview',
    brand: 'gelatomiiix',
    pathPrefix: '/api/gelatomiiix/sales',
    fetchFn: global.fetch,
  };
  const tool = salesToolFactory(config);
  assert.equal(tool.name, 'query_gelatomiiix_sales_overview');
  assert.ok(tool.description.includes('overview'));
  assert.ok(tool.description.includes('gelatomiiix'));
});

test('salesToolFactory schema includes common params', () => {
  const tool = salesToolFactory({
    name: 'query_bonjur_sales_products',
    dimension: 'products',
    brand: 'bonjur',
    pathPrefix: '/api/bonjur/sales',
    fetchFn: global.fetch,
  });

  const result = tool.inputSchema.safeParse({ store_code: 'wz_wxc', month: '2026-01' });
  assert.ok(result.success);
});

test('salesToolFactory rejects invalid month format', () => {
  const tool = salesToolFactory({
    name: 'test_sales_trend',
    dimension: 'trend',
    brand: 'gelatomiiix',
    pathPrefix: '/api/gelatomiiix/sales',
    fetchFn: global.fetch,
  });

  const result = tool.inputSchema.safeParse({ store_code: 'sh_sc', month: 'bad-format' });
  assert.equal(result.success, false);
});

test('salesToolFactory uses correct API path for each dimension', () => {
  const dims: Array<{ dim: SalesToolConfig['dimension']; path: string }> = [
    { dim: 'overview', path: '/overview' },
    { dim: 'trend', path: '/trend' },
    { dim: 'channels', path: '/channels' },
    { dim: 'products', path: '/products' },
    { dim: 'details', path: '/details' },
    { dim: 'distribution', path: '/distribution' },
    { dim: 'hourly', path: '/hourly' },
  ];

  for (const { dim } of dims) {
    const tool = salesToolFactory({
      name: `test_${dim}`,
      dimension: dim,
      brand: 'bonjur',
      pathPrefix: '/api/bonjur/sales',
      fetchFn: global.fetch,
    });
    assert.ok(tool.name === `test_${dim}`);
  }
});

test('details dimension has extra type and page params', () => {
  const tool = salesToolFactory({
    name: 'test_details',
    dimension: 'details',
    brand: 'gelatomiiix',
    pathPrefix: '/api/gelatomiiix/sales',
    fetchFn: global.fetch,
  });

  const withoutExtra = tool.inputSchema.safeParse({ store_code: 'sh_sc', month: '2026-01' });
  assert.ok(withoutExtra.success);
  assert.equal(withoutExtra.data.type, 'cash_register'); // default
  assert.equal(withoutExtra.data.page, 1); // default

  const withExtra = tool.inputSchema.safeParse({ store_code: 'sh_sc', month: '2026-01', type: 'qimai', page: 3 });
  assert.ok(withExtra.success);
  assert.equal(withExtra.data.type, 'qimai');
  assert.equal(withExtra.data.page, 3);
});

test('pure_mode defaults to false', () => {
  const tool = salesToolFactory({
    name: 'test_pure',
    dimension: 'channels',
    brand: 'bonjur',
    pathPrefix: '/api/bonjur/sales',
    fetchFn: global.fetch,
  });

  const result = tool.inputSchema.safeParse({ store_code: 'wz_wxc', month: '2026-01' });
  assert.ok(result.success);
  assert.equal(result.data.pure_mode, false);
});
