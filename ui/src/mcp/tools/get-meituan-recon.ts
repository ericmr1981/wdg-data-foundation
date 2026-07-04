import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetMeituanReconInput = z.object({
  brand: z.enum(['tamkoko']).describe('Brand code (only tamkoko supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
  t_offset: z.number().int().min(0).optional().default(3)
    .describe('Bank entry arrival offset in days from Qimai biz_date (default 3, i.e. T+3)'),
});

export const getMeituanReconTool = {
  name: 'get_meituan_recon',
  description: `Meituan (钱袋宝) settlement reconciliation for Tamkoko (泰柯茶园). Matches daily Qimai Meituan orders against bank entries from 钱袋宝 (Rules 665/327 银行分类).

**Algorithm**: Daily aggregation with T+N offset. For each Qimai biz_date, the matched bank entry window is [biz_date - 1, biz_date + t_offset) days. Default T+3 per 钱袋宝 settlement cycle.

**Parameters**:
- brand (required): tamkoko only
- period (optional): YYYY-MM format; defaults to all historical data
- span (optional): month (default), quarter, or year
- store (optional): filter by store code
- t_offset (optional): T+N offset, default 3 (T+3). Increase to 4-5 if 泰柯 reports delayed settlement.

**Returns**: { brand, period, span, store, t_offset, rows: [{ biz_date, qimai_amt, qimai_count, bank_amt, bank_count, gap }] }

**Caveats**:
- 美团 团购 (group-buy) is EXCLUDED — 团购 settles independently via get_meituan_tuangou_recon tool.
- If entry rate is consistently low, try increasing t_offset (some stores or months have longer settlement delays).
- Call get_qimai_entry_rate first for the channel-level overview.`,
  inputSchema: GetMeituanReconInput,
  async execute(params: z.infer<typeof GetMeituanReconInput>) {
    const { brand, period, span = 'month', store, t_offset = 3 } = params;
    const qs = new URLSearchParams({ brand, span, t_offset: String(t_offset) });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/meituan-recon?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_meituan_recon failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};