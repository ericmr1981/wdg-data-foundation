import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetTaobaoReconInput = z.object({
  brand: z.enum(['tamkoko']).describe('Brand code (only tamkoko supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
});

export const getTaobaoReconTool = {
  name: 'get_taobao_recon',
  description: 'Taobao (网商银行) settlement reconciliation for Tamkoko (泰柯茶园). Matches Qimai orders against bank entries from 网商银行 (Rule 421 银行分类).\n\n**Algorithm**: LAG-based window matching — each bank entry covers the Qimai order range [prev_txn_time + 1 day, current_txn_time - 3 days]. Consecutive entries produce contiguous, non-overlapping coverage.\n\n**Parameters**:\n- brand (required): tamkoko only\n- period (optional): YYYY-MM format; defaults to all historical data\n- span (optional): month (default), quarter, or year\n- store (optional): filter by store code\n\n**Returns**: { brand, period, span, store, rows: [{ bank_entry_id, txn_time, counter_party, in_amt, matched_qimai_orders[], coverage_start, coverage_end }] }\n\n**Caveats**:\n- LAG algorithm means the last entry\'s coverage may extend beyond the next entry\'s start if the gap is larger than 3 days.\n- 网商银行 entries typically appear monthly or bi-weekly; check get_qimai_entry_rate for a channel-level overview first.',
  inputSchema: GetTaobaoReconInput,
  async execute(params: z.infer<typeof GetTaobaoReconInput>) {
    const { brand, period, span = 'month', store } = params;
    const qs = new URLSearchParams({ brand, span });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch('/api/income/taobao-recon?' + qs, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error('get_taobao_recon failed: ' + err);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};