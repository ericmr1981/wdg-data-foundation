import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryQimaiRevenueInput = z.object({
  brand: brandParamSchema.describe('Brand code: gelatomiiix | bonjur | tamkoko'),
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
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await mcpFetch(`/api/financial/qimai-revenue?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'query_qimai_revenue');
    return (json as Record<string, unknown>).data ?? { note: (json as Record<string, unknown>).note ?? 'no data' };
  },
};
