import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetGelatoWechatReconInput = z.object({
  brand: z.enum(['gelatomiiix']).describe('Brand code (only gelatomiiix supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
  t_offset: z.number().int().min(0).optional().default(1)
    .describe('Bank entry arrival offset in days from Qimai biz_date (default 1, i.e. T+1)'),
});

export const getGelatoWechatReconTool = {
  name: 'get_gelato_wechat_recon',
  description: `WeChat (财付通) settlement reconciliation for Gelatomiiix (蜜可诗). Matches Qimai WeChat orders against bank entries from 财付通 (Rule 512 银行分类).

**Algorithm**: Per-entry matching. Each bank entry from 财付通 covers Qimai WeChat orders in window [entry_txn_time - t_offset, entry_txn_time]. Default T+1 daily settlement.

**Parameters**:
- brand (required): gelatomiiix only
- period (optional): YYYY-MM format; defaults to all historical data
- span (optional): month (default), quarter, or year
- store (optional): filter by store code (sh_sc or sh_xtd)
- t_offset (optional): T+N offset, default 1 (T+1). Use 0 for same-day matching.

**Returns**: { brand, period, span, store, t_offset, rows: [{ bank_entry_id, txn_time, counter_party, in_amt, matched_orders: [{ biz_date, order_no, net_amt, pay_time }] }] }

**Caveats**:
- 蜜可诗 微信支付 is direct merchant settlement via 财付通 — per-entry matching is available.
- For 泰柯 微信/支付宝, use get_settlement_cycle_recon instead (parent-company transfer model).
- Call get_qimai_entry_rate first for channel-level overview.`,
  inputSchema: GetGelatoWechatReconInput,
  async execute(params: z.infer<typeof GetGelatoWechatReconInput>) {
    const { brand, period, span = 'month', store, t_offset = 1 } = params;
    const qs = new URLSearchParams({ brand, span, t_offset: String(t_offset) });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/gelato-wechat-recon?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_gelato_wechat_recon failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};