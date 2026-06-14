import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { assertApiSuccess } from '@/lib/api-error';

const GetQimaiEntryRateInput = z.object({
  period: z.string().describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
});

export const getQimaiEntryRateTool = {
  name: 'get_qimai_entry_rate',
  description: `Analyze Qimai-to-bank entry rate for Gelatomiiix. Compares Qimai income detail (net_amt) against bank transaction entries.

**Note**: Gelatomiiix-only. The underlying API reads from gelatomiiix_ods.income_detail (hard-coded).

**Parameters**:
- period (required): YYYY-MM format
- span (optional): month (default), quarter, or year
- store (optional): filter by store

**Response**: channel-level entry rates, monthly trend, unmatched orders`,
  inputSchema: GetQimaiEntryRateInput,
  async execute(params: z.infer<typeof GetQimaiEntryRateInput>) {
    const { period, span = 'month', store } = params;
    const qs = new URLSearchParams({ brand: 'gelatomiiix', period, span });
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/gelatomiiix/income/bank-entry-stats?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'get_qimai_entry_rate');
    return (json as Record<string, unknown>).data;
  },
};
