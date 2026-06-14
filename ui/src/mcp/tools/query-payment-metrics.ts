import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryPaymentMetricsInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code (default gelatomiiix)'),
  period: z.string().optional().default('all')
    .describe('Period in YYYY-MM format, or "all" (default)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

export const queryPaymentMetricsTool = {
  name: 'query_payment_metrics',
  description: `Get payment-side metrics (expense breakdown by category: HR / MATERIAL / RENT / MKT / etc.) for financial dashboard.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- period (optional): YYYY-MM or "all" (default)
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: aggregated payment metrics (category breakdown, total_out, etc.)`,
  inputSchema: QueryPaymentMetricsInput,
  async execute(params: z.infer<typeof QueryPaymentMetricsInput>) {
    const { brand = 'gelatomiiix', period = 'all', span = 'month', store = 'all' } = params;
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await mcpFetch(`/api/financial/payment-metrics?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'query_payment_metrics');
    return (json as Record<string, unknown>).data ?? { note: (json as Record<string, unknown>).note ?? 'no data' };
  },
};
