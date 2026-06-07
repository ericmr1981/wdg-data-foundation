import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const QueryFinancialOverviewInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko']).optional().default('gelatomiiix')
    .describe('Brand code (default gelatomiiix)'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

export const queryFinancialOverviewTool = {
  name: 'query_financial_overview',
  description: `Get financial overview dashboard metrics for a brand.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- period (required): YYYY-MM
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response fields (use these names exactly)**:
- revenue (number, currency)
- expenses (number, currency, always positive — ABS sum of operating categories)
- grossMarginRate (number, DECIMAL: 0.42 means 42%. Can be negative if unprofitable.)
- netProfitRate (number, DECIMAL: 0.35 means 35%. Can be negative if unprofitable.)
- operatingCashflow (number, currency, can be negative)
- cashBalance, beginningBalance (currency)
- cashRunway (months, null if not applicable)
- storeCount, revenuePerStore, ignoreCount
- vsPrevPeriod: { revenue, grossMarginRate, netProfitRate, operatingCashflow } — period-over-period change as DECIMAL (e.g. 0.05 = +5pp). All four can be negative.

**For "毛利率 / 净利率" questions**: read grossMarginRate / netProfitRate directly. Do NOT compute from revenue/expenses.

**Cash-basis note**: this platform uses cash-basis accounting. The underlying v_profit_statement stores expenses as negative, but this overview endpoint already ABS-sums them into the positive "expenses" field.`,
  inputSchema: QueryFinancialOverviewInput,
  async execute(params: z.infer<typeof QueryFinancialOverviewInput>) {
    const { brand = 'gelatomiiix', period, span = 'month', store = 'all' } = params;
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await mcpFetch(`/api/financial/overview?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_financial_overview failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
