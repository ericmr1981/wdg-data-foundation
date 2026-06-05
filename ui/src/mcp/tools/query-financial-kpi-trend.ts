import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const QueryFinancialKpiTrendInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko']).describe('Brand code'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

export const queryFinancialKpiTrendTool = {
  name: 'query_financial_kpi_trend',
  description: `Get historical KPI trend (revenue / cost / net_profit / operating_cf) for financial dashboard chart.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- period (required): YYYY-MM (end of trend window)
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: time series of { month, revenue_amt, cost_amt, gross_profit_amt, net_profit_amt, operating_cf_amt, ... }`,
  inputSchema: QueryFinancialKpiTrendInput,
  async execute(params: z.infer<typeof QueryFinancialKpiTrendInput>) {
    const { brand, period, span = 'month', store = 'all' } = params;
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await mcpFetch(`/api/financial/kpi-trend?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_financial_kpi_trend failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
