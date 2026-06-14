import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryFinancialKpiTrendInput = z.object({
  brand: brandParamSchema.describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

export const queryFinancialKpiTrendTool = {
  name: 'query_financial_kpi_trend',
  description: `Get historical KPI trend for financial dashboard chart.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- period (required): YYYY-MM (end of trend window)
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: {
  data: {
    monthly: [
      {
        month (string, YYYY-MM),
        revenue (number, currency),
        gross_margin_rate (number, DECIMAL: 0.42 means 42%),
        net_profit_rate (number, DECIMAL: 0.35 means 35%; can be null if no data),
        operating_cashflow (number, currency, can be negative),
        expenses (number, currency, always positive)
      }
    ],
    current_month: { revenue, expenses: [...] },
    prev_month: { revenue, expenses: [...] }
  }
}

**Note**: rate fields are DECIMAL fractions, not percentages. Multiply by 100 when displaying.`,
  inputSchema: QueryFinancialKpiTrendInput,
  async execute(params: z.infer<typeof QueryFinancialKpiTrendInput>) {
    const { brand, period, span = 'month', store = 'all' } = params;
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await mcpFetch(`/api/financial/kpi-trend?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'query_financial_kpi_trend');
    return (json as Record<string, unknown>).data ?? { note: (json as Record<string, unknown>).note ?? 'no data' };
  },
};
