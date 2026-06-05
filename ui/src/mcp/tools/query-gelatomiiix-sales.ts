import { z } from 'zod';

const baseInput = {
  store_code: z.string().describe('Store code'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Month in YYYY-MM format'),
  pure_mode: z.boolean().optional().default(false)
    .describe('If true, exclude membership / discount / refund transactions (pure direct sales)'),
};

// 1) overview
export const queryGelatomiiixSalesOverviewTool = {
  name: 'query_gelatomiiix_sales_overview',
  description: `Gelatomiiix sales overview (revenue / order count / avg ticket / payment method mix).`,
  inputSchema: z.object({
    ...baseInput,
    payment_method: z.string().optional().describe('Optional: filter by payment method'),
  }),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean; payment_method?: string }) {
    const { store_code, month, pure_mode = false, payment_method } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    if (payment_method) qs.set('payment_method', payment_method);
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/overview?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_overview failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

// 2) trend
export const queryGelatomiiixSalesTrendTool = {
  name: 'query_gelatomiiix_sales_trend',
  description: `Gelatomiiix sales 12-month trend (revenue / order count by month).`,
  inputSchema: z.object(baseInput),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean }) {
    const { store_code, month, pure_mode = false } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/trend?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_trend failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

// 3) channels
export const queryGelatomiiixSalesChannelsTool = {
  name: 'query_gelatomiiix_sales_channels',
  description: `Gelatomiiix sales channel breakdown (wechat / alipay / meituan / douyin / etc.) with gross / revenue / refund.`,
  inputSchema: z.object(baseInput),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean }) {
    const { store_code, month, pure_mode = false } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/channels?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_channels failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

// 4) products
export const queryGelatomiiixSalesProductsTool = {
  name: 'query_gelatomiiix_sales_products',
  description: `Gelatomiiix product-level sales (SKU ranking by revenue / qty).`,
  inputSchema: z.object(baseInput),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean }) {
    const { store_code, month, pure_mode = false } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/products?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_products failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

// 5) details (paginated)
export const queryGelatomiiixSalesDetailsTool = {
  name: 'query_gelatomiiix_sales_details',
  description: `Gelatomiiix sales transaction details (paginated). Use type=cash_register for register slip, type=qimai for POS.`,
  inputSchema: z.object({
    ...baseInput,
    type: z.enum(['cash_register', 'qimai']).optional().default('cash_register')
      .describe('Detail source: cash_register (default) | qimai'),
    page: z.number().int().positive().optional().default(1).describe('Page number (default 1)'),
  }),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean; type?: 'cash_register' | 'qimai'; page?: number }) {
    const { store_code, month, pure_mode = false, type = 'cash_register', page = 1 } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month, type, page: String(page) });
    if (pure_mode) qs.set('pure_mode', 'true');
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/details?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_details failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

// 6) distribution
export const queryGelatomiiixSalesDistributionTool = {
  name: 'query_gelatomiiix_sales_distribution',
  description: `Gelatomiiix sales distribution (order-count / revenue-share by channel or by time bucket).`,
  inputSchema: z.object(baseInput),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean }) {
    const { store_code, month, pure_mode = false } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/distribution?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_distribution failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

// 7) hourly
export const queryGelatomiiixSalesHourlyTool = {
  name: 'query_gelatomiiix_sales_hourly',
  description: `Gelatomiiix sales hourly distribution (0-23h buckets). Useful for peak-hour analysis.`,
  inputSchema: z.object(baseInput),
  async execute(params: { store_code: string; month: string; pure_mode?: boolean }) {
    const { store_code, month, pure_mode = false } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    const res = await fetch(`${baseUrl}/api/gelatomiiix/sales/hourly?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_gelatomiiix_sales_hourly failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
