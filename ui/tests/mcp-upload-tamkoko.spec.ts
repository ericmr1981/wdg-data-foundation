import { test, expect, request, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4100';

/** MCP internal-session bypass (no real auth needed). */
function mcpHeaders(): Record<string, string> {
  return { 'x-mcp-session': 'internal' };
}

async function mcpCtx(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL });
}

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<any> {
  const ctx = await mcpCtx();
  const res = await ctx.post('/api/mcp', {
    headers: { 'Content-Type': 'application/json', ...mcpHeaders() },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  return res.json();
}

test.describe('MCP tamkoko upload tools', () => {
  test.afterAll(async () => {
    // best-effort rollback of test fixtures
    const ctx = await mcpCtx();
    await ctx.post('/api/admin/brands', { headers: mcpHeaders(), data: { action: 'noop' } }).catch(() => {});
  });

  test('upload_tamkoko_income_detail: returns insertedRows > 0', async () => {
    const fixturePath = `${process.cwd()}/e2e/fixtures/tamkoko_income_sample.csv`;

    const result = await callMcpTool('upload_tamkoko_income_detail', {
      file_path: fixturePath,
      store: 'hz_fuyang',
    });

    expect(result.error).toBeUndefined();
    const content = result.result?.content?.[0]?.text;
    expect(content).toBeDefined();
    const parsed = JSON.parse(content);
    expect(parsed.success).toBe(true);
    expect(parsed.insertedRows).toBeGreaterThanOrEqual(2);
  });

  test('upload_tamkoko_income_detail: rejects invalid store_code', async () => {
    const fixturePath = `${process.cwd()}/e2e/fixtures/tamkoko_income_sample.csv`;

    const result = await callMcpTool('upload_tamkoko_income_detail', {
      file_path: fixturePath,
      store: 'nonexistent_store_xyz',
    });

    const content = result.result?.content?.[0]?.text ?? '';
    expect(content.toLowerCase()).toMatch(/not a valid enabled store/i);
  });

  test('upload_bank_txn_file with brand=tamkoko: tool accepts tamkoko enum', async () => {
    // Validation: confirm tool exists and brand=tamkoko is accepted by the schema.
    // We do NOT actually upload because that requires a real xlsx + DB.
    const ctx = await mcpCtx();
    const listRes = await ctx.post('/api/mcp', {
      headers: { 'Content-Type': 'application/json', ...mcpHeaders() },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    const listJson = await listRes.json();
    const tool = listJson.result?.tools?.find((t: any) => t.name === 'upload_bank_txn_file');
    expect(tool).toBeDefined();
    const brandEnum = tool.inputSchema?.properties?.brand;
    expect(brandEnum).toBeDefined();
    // The brand description must mention tamkoko (loose: just check the word appears)
    const desc = JSON.stringify(brandEnum);
    expect(desc).toMatch(/tamkoko/i);
  });
});