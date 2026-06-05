import { z } from 'zod';

const QueryQimaiRevenueInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko']).describe('Brand code'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

export const queryQimaiRevenueTool = {
  name: 'query_qimai_revenue',
  description: `Get Qimai (企迈) revenue split — gross / net / refund by store. Used for revenue reconciliation against bank.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- period (required): YYYY-MM
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: rows of { store, gross_amt, net_amt, refund_amt, order_count, ... }`,
  inputSchema: QueryQimaiRevenueInput,
  async execute(params: z.infer<typeof QueryQimaiRevenueInput>) {
    const { brand, period, span = 'month', store = 'all' } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await fetch(`${baseUrl}/api/financial/qimai-revenue?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_qimai_revenue failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
