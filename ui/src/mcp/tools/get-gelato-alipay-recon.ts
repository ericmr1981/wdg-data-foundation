import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetGelatoAlipayReconInput = z.object({
  brand: z.enum(['gelatomiiix']).describe('Brand code (only gelatomiiix supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
  t_offset: z.number().int().min(0).optional().default(0)
    .describe('Bank entry arrival offset in days from Qimai biz_date (default 0, monthly settlement via LAG)'),
});

export const getGelatoAlipayReconTool = {
  name: 'get_gelato_alipay_recon',
  description: `Alipay (支付宝支付科技) settlement reconciliation for Gelatomiiix (蜜可诗). Matches Qimai Alipay orders against bank entries from 支付宝支付科技 (Rules 591/592 银行分类).

**Algorithm**: LAG-based window matching. 支付宝 settles monthly rather than daily, so bank entry timing is irregular. Each entry covers Qimai orders from the previous entry's coverage end to [entry_txn_time - t_offset]. Default T+0 (same-month matching).

**Parameters**:
- brand (required): gelatomiiix only
- period (optional): YYYY-MM format; defaults to all historical data
- span (optional): month (default), quarter, or year
- store (optional): filter by store code (sh_sc or sh_xtd)
- t_offset (optional): T+N offset, default 0. Increase to 1-3 if monthly settlement reports arrive late.

**Returns**: { brand, period, span, store, t_offset, rows: [{ bank_entry_id, txn_time, counter_party, in_amt, matched_orders: [{ biz_date, order_no, net_amt, pay_time }], coverage_start, coverage_end }] }

**Caveats**:
- 支付宝 settles monthly (not daily), so bank entries are sparse. A single entry may cover 2-4 weeks of orders.
- LAG algorithm: each entry's coverage starts where the previous entry's coverage ended, so no gaps or overlaps.
- If an entry is missing (e.g., month-end entry not yet arrived), the last matched entry's coverage may extend past the queried period.
- For 泰柯 支付宝, use get_settlement_cycle_recon instead (parent-company transfer model).
- Call get_qimai_entry_rate first for channel-level overview.`,
  inputSchema: GetGelatoAlipayReconInput,
  async execute(params: z.infer<typeof GetGelatoAlipayReconInput>) {
    const { brand, period, span = 'month', store, t_offset = 0 } = params;
    const qs = new URLSearchParams({ brand, span, t_offset: String(t_offset) });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/gelato-alipay-recon?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_gelato_alipay_recon failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};