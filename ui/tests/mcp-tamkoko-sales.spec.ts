import { test, expect, APIRequestContext, request } from '@playwright/test';

const MCP_PATH = '/api/mcp';
const MCP_HEADERS = { 'Content-Type': 'application/json', 'x-mcp-session': 'internal' };

async function callMcpTool(ctx: APIRequestContext, name: string, args: Record<string, unknown>): Promise<any> {
    const res = await ctx.post(MCP_PATH, {
        headers: MCP_HEADERS,
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    return res.json();
}

function unwrap(result: any): any {
    if (result?.result?.isError) throw new Error(result.result.content[0].text);
    const text = result?.result?.content?.[0]?.text ?? '{}';
    return JSON.parse(text);
}

let ctx: APIRequestContext;
test.beforeAll(async () => { ctx = await request.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4300' }); });
test.afterAll(async () => { await ctx.dispose(); });

test('query_tamkoko_sales_overview returns 1 row for sh_sjh/2026-06', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_overview', { store: 'sh_sjh', month: '2026-06-01' });
    const data = unwrap(r);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    // pg NUMERIC columns arrive as strings over JSON; coerce before comparing.
    expect(Number(data[0].gross_amt)).toBeCloseTo(432778.82, 0);
    expect(Number(data[0].revenue_amt)).toBeCloseTo(272427.09, 0);
});

test('query_tamkoko_sales_channel returns ≥3 sources', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_channel', { store: 'sh_sjh', month: '2026-06-01' });
    const data = unwrap(r);
    expect(data.length).toBeGreaterThanOrEqual(3);
});

test('query_tamkoko_sales_dine_takeaway returns ≥2 types', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_dine_takeaway', { store: 'sh_sjh', month: '2026-06-01' });
    const data = unwrap(r);
    expect(data.length).toBeGreaterThanOrEqual(2);
});

test('query_tamkoko_sales_meal_period returns ≥2 periods', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_meal_period', { store: 'sh_sjh', month: '2026-06-01' });
    const data = unwrap(r);
    expect(data.length).toBeGreaterThanOrEqual(2);
});

test('query_tamkoko_sales_weekday returns ≥4 weekdays', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_weekday', { store: 'sh_sjh' });
    const data = unwrap(r);
    expect(data.length).toBeGreaterThanOrEqual(4);
});

test('query_tamkoko_sales_multi_store returns ≥1 row', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_multi_store', { month: '2026-06-01' });
    const data = unwrap(r);
    expect(data.length).toBeGreaterThanOrEqual(1);
});

test('query_tamkoko_sales_combined returns ≥2 rows + whitelist enforces', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_combined', {
        store: 'sh_sjh', month: '2026-06-01', dim1: 'order_source', dim2: 'order_type',
    });
    const data = unwrap(r);
    expect(data.length).toBeGreaterThanOrEqual(2);

    // 白名单测试:非法 dim 应抛错(JSON-RPC error.code -32602, message 含 invalid enum)
    const bad = await callMcpTool(ctx, 'query_tamkoko_sales_combined', {
        store: 'sh_sjh', month: '2026-06-01', dim1: 'evil; DROP TABLE x;--', dim2: 'order_type',
    });
    expect(bad.error).toBeDefined();
    expect(bad.error.code).toBe(-32602);
    expect(bad.error.message).toMatch(/invalid_enum_value/i);
});

test('upload_tamkoko_cash_register: SHA256 hit returns skipped:true', async () => {
    // fixture 已 import 过(SHA256 命中),用 x-mcp-session bypass
    const r = await callMcpTool(ctx, 'upload_tamkoko_cash_register', {
        file_path: '/Users/ericmr/Documents/GitHub/wdg-data-foundation/tests/qmaidata/收银明细表-2026-06-012026-06-30-2db20cd6a8dd430281da929b43726c6f.csv',
        store_code: 'sh_sjh',
        period: '2026-06',
    });
    const data = unwrap(r);
    expect(data.skipped).toBe(true);
    expect(data.sourceFileId).toBeGreaterThan(0);
});

test('query_tamkoko_sales_overview without store returns multi-store data', async () => {
    const r = await callMcpTool(ctx, 'query_tamkoko_sales_overview', { month: '2026-06-01' });
    const data = unwrap(r);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(1); // 多店
    const stores = new Set(data.map((r: any) => r.store_code));
    expect(stores.size).toBeGreaterThan(1);
});

test('query_tamkoko_sales_combined is removed from tools/list', async () => {
    const r = await ctx.post(MCP_PATH, {
        headers: MCP_HEADERS,
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    const tools = (await r.json()).result.tools;
    const names = tools.map((t: any) => t.name);
    expect(names).not.toContain('query_tamkoko_sales_combined');
});

test('query_tamkoko_sales_multi_store description mentions 多店比对', async () => {
    const r = await ctx.post(MCP_PATH, {
        headers: MCP_HEADERS,
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    const tools = (await r.json()).result.tools;
    const ms = tools.find((t: any) => t.name === 'query_tamkoko_sales_multi_store');
    expect(ms.description).toContain('多店比对');
});
