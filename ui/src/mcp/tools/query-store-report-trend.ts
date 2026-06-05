import { z } from 'zod';

const QueryStoreReportTrendInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko']).describe('Brand code'),
  store: z.string().describe('Store code'),
  months: z.number().int().min(1).max(24).optional().default(12)
    .describe('Number of trailing months (1-24, default 12)'),
});

export const queryStoreReportTrendTool = {
  name: 'query_store_report_trend',
  description: `Get historical KPI trend for a single store. Returns monthly time series for revenue / cost / expense / hr / rent / gross_profit / net_profit / operating_cf / cash_balance / loan_balance + rate metrics.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- store (required): store code
- months (optional): 1-24, default 12

**Response**: { month: string, values: { revenue_amt, cost_amt, hr_amt, rent_amt, gross_profit_amt, net_profit_amt, ... } }[]`,
  inputSchema: QueryStoreReportTrendInput,
  async execute(params: z.infer<typeof QueryStoreReportTrendInput>) {
    const { brand, store, months = 12 } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ brand, store, months: String(months) });

    const res = await fetch(`${baseUrl}/api/store-report/trend?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`query_store_report_trend failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
