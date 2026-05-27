import { z } from 'zod';

const GetQimaiEntryRateInput = z.object({
  period: z.string().describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
});

export const getQimaiEntryRateTool = {
  name: 'get_qimai_entry_rate',
  description: `Analyze Qimai-to-bank entry rate for Gelatomiiix. Compares Qimai income detail (net_amt) against bank transaction entries.

**Parameters**:
- period (required): YYYY-MM format
- span (optional): month (default), quarter, or year
- store (optional): filter by store

**Response**: channel-level entry rates, monthly trend, unmatched orders`,
  inputSchema: GetQimaiEntryRateInput,
  async execute(params: z.infer<typeof GetQimaiEntryRateInput>) {
    const { period, span = 'month', store } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ brand: 'gelatomiiix', period, span });
    if (store) qs.set('store', store);

    const res = await fetch(`${baseUrl}/api/gelatomiiix/income/bank-entry-stats?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_qimai_entry_rate failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
