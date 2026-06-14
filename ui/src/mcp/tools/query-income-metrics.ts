import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';

const QueryIncomeMetricsInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code (default gelatomiiix)'),
  period: z.string().optional().default('all')
    .describe('Period in YYYY-MM format, or "all" (default)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

export const queryIncomeMetricsTool = {
  name: 'query_income_metrics',
  description: `Get income-side metrics (revenue breakdown, channel mix, Qimai-bank match rate) for financial dashboard.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- period (optional): YYYY-MM or "all" (default)
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: aggregated income metrics (channel breakdown, Qimai revenue, etc.)`,
  inputSchema: QueryIncomeMetricsInput,
  async execute(params: z.infer<typeof QueryIncomeMetricsInput>) {
    const { brand = 'gelatomiiix', period = 'all', span = 'month', store = 'all' } = params;
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await mcpFetch(`/api/financial/income-metrics?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_income_metrics failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
