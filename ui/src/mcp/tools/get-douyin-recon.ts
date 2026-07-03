import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetDouyinReconInput = z.object({
  brand: z.enum(['tamkoko']).describe('Brand code (only tamkoko supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
  t_offset: z.number().int().min(0).optional().default(5)
    .describe('Bank entry arrival offset in days from Qimai biz_date (default 5, i.e. T+5)'),
});

export const getDouyinReconTool = {
  name: 'get_douyin_recon',
  description: `Douyin (抖音团购券) settlement reconciliation for Tamkoko (泰柯茶园). Matches daily Qimai Douyin orders against bank entries from 江苏银行 (Rule 707 银行分类).

**Algorithm**: Daily aggregation with T+N offset. Default T+5 per 抖音团购券 settlement cycle.

**Parameters**:
- brand (required): tamkoko only
- period (optional): YYYY-MM format; defaults to all historical data
- span (optional): month (default), quarter, or year
- store (optional): filter by store code
- t_offset (optional): T+N offset, default 5 (T+5). Increase to 6-7 if settlement is delayed.

**Returns**: { brand, period, span, store, t_offset, rows: [{ biz_date, qimai_amt, qimai_count, bank_amt, bank_count, gap }] }

**Caveats**:
- 抖音团购券 has a longer settlement cycle (T+5 vs Meituan's T+3). If entry rate appears low, check whether orders are still within the T+5 window.
- Call get_qimai_entry_rate first for the channel-level overview.`,
  inputSchema: GetDouyinReconInput,
  async execute(params: z.infer<typeof GetDouyinReconInput>) {
    const { brand, period, span = 'month', store, t_offset = 5 } = params;
    const qs = new URLSearchParams({ brand, span, t_offset: String(t_offset) });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/douyin-recon?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_douyin_recon failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};