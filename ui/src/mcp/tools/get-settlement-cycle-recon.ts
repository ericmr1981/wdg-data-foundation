import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetSettlementCycleReconInput = z.object({
  brand: z.enum(['tamkoko']).describe('Brand code (only tamkoko supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
});

export const getSettlementCycleReconTool = {
  name: 'get_settlement_cycle_recon',
  description: `支付宝+微信对账 for Tamkoko (泰柯茶园). Matches parent-company "苏州泰柯" bank transfers against Qimai WECHAT+ALIPAY orders using LAG-based windowing. Returns per-bank-entry rows with bank amount, order count, order amount, and entry rate.

**Parameters**:
- brand (required): tamkoko only
- period (optional): YYYY-MM format; defaults to all historical data
- span (optional): month (default), quarter, or year
- store (optional): filter by store code

**Returns**: { brand, period, span, store, rows: [{ bank_date, bank_amt, window_days, qimai_count, qimai_amt, diff, entry_rate }] }

**Caveats**:
- Tamkoko's WECHAT + ALIPAY are NOT direct merchant settlement — they go through parent-company 苏州泰柯 bank transfer. This tool matches Qimai totals against the parent-company transfer entries rather than individual payment processor settlement.
- For direct per-channel settlement check, use get_qimai_entry_rate for the merged WECHAT_ALIPAY card, or get_meituan_recon / get_douyin_recon for those channels.`,
  inputSchema: GetSettlementCycleReconInput,
  async execute(params: z.infer<typeof GetSettlementCycleReconInput>) {
    const { brand, period, span = 'month', store } = params;
    const qs = new URLSearchParams({ brand, span });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/cycle-recon?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_settlement_cycle_recon failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};