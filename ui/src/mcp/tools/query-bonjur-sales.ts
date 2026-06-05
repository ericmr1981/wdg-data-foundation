import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryBonjurSalesProductsTool = {
  name: 'query_bonjur_sales_products',
  description: `Bonjur product-level sales (SKU ranking by revenue / qty).`,
  inputSchema: z.object({
    store_code: z.string().describe('Store code'),
    month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Month in YYYY-MM format'),
  }),
  async execute(params: { store_code: string; month: string }) {
    const { store_code, month } = params;
    const qs = new URLSearchParams({ store_code, month });
    const res = await mcpFetch(`/api/bonjur/sales/products?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_bonjur_sales_products failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};

export const queryBonjurSalesDetailsTool = {
  name: 'query_bonjur_sales_details',
  description: `Bonjur sales transaction details (paginated). Use type=cash_register for register slip, type=qimai for POS.`,
  inputSchema: z.object({
    store_code: z.string().describe('Store code'),
    month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Month in YYYY-MM format'),
    type: z.enum(['cash_register', 'qimai']).optional().default('cash_register')
      .describe('Detail source: cash_register (default) | qimai'),
    page: z.number().int().positive().optional().default(1).describe('Page number (default 1)'),
    limit: z.number().int().positive().max(200).optional().default(50)
      .describe('Page size (default 50, max 200)'),
  }),
  async execute(params: { store_code: string; month: string; type?: 'cash_register' | 'qimai'; page?: number; limit?: number }) {
    const { store_code, month, type = 'cash_register', page = 1, limit = 50 } = params;
    const qs = new URLSearchParams({ store_code, month, type, page: String(page), limit: String(limit) });
    const res = await mcpFetch(`/api/bonjur/sales/details?${qs}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(`query_bonjur_sales_details failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
