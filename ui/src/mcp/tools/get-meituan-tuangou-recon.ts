import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetMeituanTuangouReconInput = z.object({
  brand: z.enum(['tamkoko']).describe('Brand code (only tamkoko supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
  t_offset: z.number().int().min(0).optional().default(5)
    .describe('Bank entry arrival offset in days from Qimai biz_date (default 5, i.e. T+5)'),
});

export const getMeituanTuangouReconTool = {
  name: 'get_meituan_tuangou_recon',
  description: `美团团购券 reconciliation for Tamkoko (泰柯茶园). Meituan group-buy settles independently from Meituan delivery — bank entries matched via summary LIKE '%团购%' against Qimai 美团团购券 orders.

**Algorithm**: LAG-based sliding window (similar to taobao-recon). Raw window = [prev_bank_date, bank_date - 1], shifted left by T+5 days to get the Qimai order date range.

**Parameters**:
- brand (required): tamkoko only
- period (optional): YYYY-MM format; defaults to all historical data
- span (optional): month (default), quarter, or year
- store (optional): filter by store code
- t_offset (optional): T+N offset, default 5 (T+5). Increase to 6-7 if needed.

**Returns**: { brand, period, span, store, t_offset, rows: [{ bank_date_str, bank_amt, qimai_window, window_days, qimai_count, qimai_total, diff, entry_rate }] }

**Caveats**:
- This is the MEITUAN_TUANGOU channel — separate from get_meituan_recon (美团外卖). Both channels exist simultaneously for tamkoko.
- Call get_qimai_entry_rate first for the channel-level overview.`,
  inputSchema: GetMeituanTuangouReconInput,
  async execute(params: z.infer<typeof GetMeituanTuangouReconInput>) {
    const { brand, period, span = 'month', store, t_offset = 5 } = params;
    const qs = new URLSearchParams({ brand, span, t_offset: String(t_offset) });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/meituan-tuangou-recon?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_meituan_tuangou_recon failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
