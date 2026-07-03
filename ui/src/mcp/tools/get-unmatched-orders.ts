import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetUnmatchedOrdersInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko', 'yufeng', 'xintiandi'])
    .describe('Brand code'),
  period: z.string().describe('Period in YYYY-MM format'),
  store: z.string().optional().describe('Filter by store code'),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().positive().max(200).optional().default(50),
});

export const getUnmatchedOrdersTool = {
  name: 'get_unmatched_orders',
  description: `List individual income_detail orders with no third_party_txn_no (i.e. not yet matched to a bank entry). For locating which specific orders are missing after get_qimai_entry_rate identifies a low-entry-rate channel.

**Workflow**: Call get_qimai_entry_rate first to find low-entry-rate channels; then call this tool with the same brand+period to enumerate the orders. Cross-reference with get_txn_detail to verify bank side.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko | yufeng | xintiandi
- period (required): YYYY-MM
- store (optional): store_code filter
- page / page_size (optional): default 1 / 50, max 200

**Returns**: { brand_support, total, page, page_size, orders: [{biz_date, store_code, order_no, third_party_txn_no, net_amt, payment_methods, pay_time}] }

**Caveats**:
- third_party_txn_no IS NULL is a PROXY: 现金/会员快速支付/部分美团核销不走第三方流水号. Inspect payment_methods array to identify offline channels.
- T+N 延迟:银行入账通常滞后 1-2 天.
- 自动排除 is_refund / is_member_payment(gelatomiiix / bonjur / tamkoko 都有这两列).

**Brand support**:
- gelatomiiix / bonjur / tamkoko: supported
- yufeng: not_supported (no income_detail DDL)
- xintiandi: not_deployed (template schema only)`,
  inputSchema: GetUnmatchedOrdersInput,
  async execute(params: z.infer<typeof GetUnmatchedOrdersInput>) {
    const { brand, period, store, page = 1, page_size = 50 } = params;
    const qs = new URLSearchParams({ brand, period, page: String(page), page_size: String(page_size) });
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