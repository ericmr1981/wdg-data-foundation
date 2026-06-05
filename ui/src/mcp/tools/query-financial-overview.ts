import { z } from 'zod';

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
  description: `Get financial overview dashboard (revenue / cost / gross_profit / net_profit / operating_cf / cash_balance / loan_balance).

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- period (required): YYYY-MM
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: { revenue_amt, cost_amt, gross_profit_amt, net_profit_amt, operating_cf_amt, cash_balance, loan_balance, ... }`,
  inputSchema: QueryFinancialOverviewInput,
  async execute(params: z.infer<typeof QueryFinancialOverviewInput>) {
    const { brand = 'gelatomiiix', period, span = 'month', store = 'all' } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ brand, period, span, store });
    const res = await fetch(`${baseUrl}/api/financial/overview?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_financial_overview failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
