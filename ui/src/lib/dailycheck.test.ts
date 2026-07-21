import { test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

// 通过 stub global.fetch 测试。da = dailycheck helpers。
// 测试前把 DAILYCHECK_MCP_TOKEN 设好,不然 module load 时抛 missing-config。

process.env.DAILYCHECK_MCP_TOKEN = 'test-token';
process.env.DAILYCHECK_URL = 'http://dailycheck.test';

import {
  callDailyCheckRpc,
  listWarehouses,
  getWarehouseTotal,
  getTurnoverTop,
  getCategoryDistribution,
  DailyCheckUnavailableError,
  DailyCheckToolError,
} from './dailycheck.ts';

interface FetchCall {
  url: string;
  init: RequestInit;
}

let originalFetch: typeof fetch | undefined;

test.beforeEach(() => { originalFetch = globalThis.fetch; });
test.afterEach(() => { if (originalFetch) globalThis.fetch = originalFetch; });

function stubFetch(responses: Array<{ status: number; body: unknown }>): FetchCall[] {
  const calls: FetchCall[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[i++] ?? responses[responses.length - 1];
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return calls;
}

test('callDailyCheckRpc forwards jsonrpc envelope and bearer', async () => {
  const calls = stubFetch([{ status: 200, body: { jsonrpc: '2.0', id: 1, result: { ok: true } } }]);
  const out = await callDailyCheckRpc('tools/call', { name: 'warehouse_list' });
  assert.equal((out as { ok: boolean }).ok, true);
  assert.equal(calls.length, 1);
  const init = calls[0].init;
  assert.equal(init.method, 'POST');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['authorization'], 'Bearer test-token');
  assert.equal(headers['accept'], 'application/json');
  const body = JSON.parse(init.body as string);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.method, 'tools/call');
  assert.deepEqual(body.params, { name: 'warehouse_list' });
});

test('callDailyCheckRpc throws DailyCheckUnavailableError on HTTP 401', async () => {
  stubFetch([{ status: 401, body: { error: 'unauthorized' } }]);
  await assert.rejects(() => callDailyCheckRpc('tools/list'), DailyCheckUnavailableError);
});

test('callDailyCheckRpc throws DailyCheckToolError when result.isError', async () => {
  stubFetch([{
    status: 200,
    body: {
      jsonrpc: '2.0', id: 1, result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'not_found', message: 'no wh' }) }],
      },
    },
  }]);
  await assert.rejects(() => callDailyCheckRpc('tools/call', { name: 'items_list' }), DailyCheckToolError);
});

test('listWarehouses parses content[0].text JSON', async () => {
  stubFetch([{
    status: 200,
    body: {
      jsonrpc: '2.0', id: 1, result: {
        content: [{ type: 'text', text: JSON.stringify([
          { code: 'wh_001', name: '供应链仓' },
          { code: 'wh_002', name: '门店仓' },
        ]) }],
      },
    },
  }]);
  const list = await listWarehouses();
  assert.deepEqual(list, [{ code: 'wh_001', name: '供应链仓' }, { code: 'wh_002', name: '门店仓' }]);
});

test('getWarehouseTotal sums current_stock', async () => {
  stubFetch([{
    status: 200,
    body: {
      jsonrpc: '2.0', id: 1, result: {
        content: [{ type: 'text', text: JSON.stringify([
          { item_id: 1, current_stock: 10 },
          { item_id: 2, current_stock: 5.5 },
          { item_id: 3, current_stock: 0 },
        ]) }],
      },
    },
  }]);
  const total = await getWarehouseTotal('wh_001');
  assert.equal(total, 15.5);
});

test('getWarehouseTotal returns 0 on empty array', async () => {
  stubFetch([{
    status: 200,
    body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '[]' }] } },
  }]);
  assert.equal(await getWarehouseTotal('wh_empty'), 0);
});

test('getTurnoverTop passes days=30, sort_by=turnover, limit=20', async () => {
  const calls = stubFetch([{
    status: 200,
    body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '[]' }] } },
  }]);
  await getTurnoverTop('wh_001');
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.params.arguments, {
    warehouse_code: 'wh_001', days: 30, sort_by: 'turnover', limit: 20,
  });
});

test('getCategoryDistribution groups by category and sums stock', async () => {
  stubFetch([{
    status: 200,
    body: {
      jsonrpc: '2.0', id: 1, result: {
        content: [{ type: 'text', text: JSON.stringify([
          { item_id: 1, category: '包材', current_stock: 10 },
          { item_id: 2, category: '包材', current_stock: 5 },
          { item_id: 3, category: '辅料', current_stock: 8 },
        ]) }],
      },
    },
  }]);
  const cats = await getCategoryDistribution('wh_001');
  // 字母序稳定排序
  assert.deepEqual(cats, [
    { category: '包材', total_stock: 15 },
    { category: '辅料', total_stock: 8 },
  ]);
});
