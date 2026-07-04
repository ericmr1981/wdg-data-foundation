import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetUnmatchedOrdersInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur'])
    .describe('Brand code (gelatomiiix / bonjur only — tamkoko, yufeng, xintiandi not supported)'),
  period: z.string().describe('Period in YYYY-MM format'),
  store: z.string().optional().describe('Filter by store code'),
});

export const getUnmatchedOrdersTool = {
  name: 'get_unmatched_orders',
  description: `Aggregate income_detail orders with no third_party_txn_no (i.e. not yet matched to a bank entry), grouped by month.

**Workflow**: Call get_qimai_entry_rate first to find low-entry-rate channels; then call this tool to see monthly unmatched totals. Cross-reference with get_txn_detail to verify bank side.

**Parameters**:
- brand (required): gelatomiiix | bonjur
- period (required): YYYY-MM
- store (optional): store_code filter

**Returns**: { brand, period, span, store, rows: [{month, order_count, unentered_amt}] }

**Brand support**:
- gelatomiiix / bonjur: supported
- tamkoko / yufeng / xintiandi: not supported`,
  inputSchema: GetUnmatchedOrdersInput,
  async execute(params: z.infer<typeof GetUnmatchedOrdersInput>) {
    const { brand, period, store } = params;
    const qs = new URLSearchParams({ brand, period });
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/unmatched-orders?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_unmatched_orders failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};